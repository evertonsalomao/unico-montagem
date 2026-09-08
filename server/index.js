"use strict";

require("dotenv").config();

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");

const { q, um, verificar } = require("./db");
const auth = require("./auth");
const P = require("./permissoes");
const rotasOs = require("./rotas/os");
const rotasAdmin = require("./rotas/admin");

const app = express();
if (String(process.env.TRUST_PROXY || "true").toLowerCase() === "true") {
  app.set("trust proxy", 1);
}
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

function erro(res, codigo, mensagem) {
  return res.status(codigo).json({ erro: mensagem });
}
function texto(v, max) {
  return String(v == null ? "" : v).trim().slice(0, max);
}

/* =====================================================================
   Sessão
   ===================================================================== */

/** Exige sessão válida. Tudo abaixo de /api (fora de login/estado) passa aqui. */
async function exigirLogin(req, res, next) {
  try {
    const usuario = await auth.usuarioDaSessao(req);
    if (!usuario) return erro(res, 401, "Faça login para continuar.");
    req.usuario = usuario;
    next();
  } catch (e) {
    next(e);
  }
}

/* =====================================================================
   Rotas abertas
   ===================================================================== */

/** Health check para o Coolify / monitoramento */
app.get("/health", (req, res) => res.status(200).send("OK"));
app.get("/api/health", (req, res) => res.status(200).json({ status: "ok" }));

/** A interface chama isto ao abrir, antes de qualquer login. */
app.get("/api/estado", async (req, res, next) => {
  try {
    const admins = await verificar();
    const usuario = await auth.usuarioDaSessao(req);
    res.json({
      precisaInstalar: admins === 0,
      eu: usuario ? P.resumo(usuario) : null,
      etapas: P.ORDEM_ETAPAS.map((k) => ({ chave: k, rotulo: P.ETAPAS[k].rotulo, lab: P.ETAPAS[k].lab })),
    });
  } catch (e) {
    next(e);
  }
});

/** Primeiro acesso: cria o administrador. Só funciona se não existir nenhum. */
app.post("/api/instalar", async (req, res, next) => {
  try {
    if ((await verificar()) > 0) return erro(res, 409, "O sistema já tem administrador.");
    const senha = String(req.body.senha || "");
    if (senha.length < 6) return erro(res, 400, "A senha precisa ter no mínimo 6 caracteres.");
    const s = await auth.gerarSegredo(senha);
    await q(
      `INSERT INTO usuarios (login, nome, perfil, loja, senha_hash, senha_sal, senha_iter,
                             ativo, trocar_senha, criado_em)
       VALUES ('fred', 'Fred', 'admin', NULL, ?, ?, ?, 1, 0, NOW())
       ON DUPLICATE KEY UPDATE senha_hash = VALUES(senha_hash), senha_sal = VALUES(senha_sal),
                               senha_iter = VALUES(senha_iter), perfil = 'admin', ativo = 1,
                               trocar_senha = 0`,
      [s.hash, s.sal, s.rodadas]
    );
    await auth.abrirSessao(req, res, "fred");
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.post("/api/login", async (req, res, next) => {
  try {
    const login = texto(req.body.login, 40).toLowerCase();
    const senha = String(req.body.senha || "");
    if (!login || !senha) return erro(res, 400, "Informe o usuário e a senha.");

    const usuario = await um(
      `SELECT login, nome, perfil, loja, ativo, trocar_senha,
              senha_hash, senha_sal, senha_iter
         FROM usuarios WHERE login = ?`,
      [login]
    );
    // Mensagem única para usuário inexistente e senha errada: não
    // entregamos a quem tenta a informação de que o login existe.
    if (!usuario) return erro(res, 401, "Usuário ou senha inválidos.");
    if (!usuario.ativo) return erro(res, 403, "Este acesso está inativo. Fale com o Fred.");
    if (!(await auth.conferirSenha(senha, usuario))) {
      return erro(res, 401, "Usuário ou senha inválidos.");
    }
    await auth.abrirSessao(req, res, usuario.login);
    // O cookie acabou de ir na resposta e ainda não voltou em req.cookies,
    // então o resumo sai da linha que já temos em mãos.
    res.json({ ok: true, eu: P.resumo(usuario) });
  } catch (e) {
    next(e);
  }
});

app.post("/api/logout", async (req, res, next) => {
  try {
    await auth.fecharSessao(req, res);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* =====================================================================
   Rotas com sessão
   ===================================================================== */

app.use("/api", exigirLogin);

app.get("/api/inicio", async (req, res, next) => {
  try {
    const lojas = await q("SELECT nome FROM lojas WHERE ativa = 1 ORDER BY ordem, nome");
    const os = await q(
      P.perfilDe(req.usuario).verTudo
        ? "SELECT * FROM os ORDER BY data_entrega DESC, criado_em DESC LIMIT 2000"
        : "SELECT * FROM os WHERE loja = ? ORDER BY data_entrega DESC, criado_em DESC LIMIT 2000",
      P.perfilDe(req.usuario).verTudo ? [] : [req.usuario.loja]
    );
    res.json({ eu: P.resumo(req.usuario), lojas: lojas.map((l) => l.nome), os });
  } catch (e) {
    next(e);
  }
});

app.post("/api/senha", async (req, res, next) => {
  try {
    const atual = String(req.body.atual || "");
    const nova = String(req.body.nova || "");
    if (nova.length < 6) return erro(res, 400, "A nova senha precisa ter no mínimo 6 caracteres.");
    if (!(await auth.conferirSenha(atual, req.usuario))) {
      return erro(res, 403, "A senha atual está incorreta.");
    }
    if (atual === nova) return erro(res, 400, "A nova senha deve ser diferente da atual.");
    const s = await auth.gerarSegredo(nova);
    await q(
      "UPDATE usuarios SET senha_hash = ?, senha_sal = ?, senha_iter = ?, trocar_senha = 0 WHERE login = ?",
      [s.hash, s.sal, s.rodadas, req.usuario.login]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** Troca obrigatória no primeiro acesso: não pede a senha antiga. */
app.post("/api/primeira-senha", async (req, res, next) => {
  try {
    if (!req.usuario.trocar_senha) return erro(res, 409, "Sua senha já foi definida.");
    const nova = String(req.body.nova || "");
    if (nova.length < 6) return erro(res, 400, "A senha precisa ter no mínimo 6 caracteres.");
    const s = await auth.gerarSegredo(nova);
    await q(
      "UPDATE usuarios SET senha_hash = ?, senha_sal = ?, senha_iter = ?, trocar_senha = 0 WHERE login = ?",
      [s.hash, s.sal, s.rodadas, req.usuario.login]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.use("/api/os", rotasOs);
app.use("/api/admin", rotasAdmin);

/* =====================================================================
   Interface + erros
   ===================================================================== */

app.use(express.static(path.join(__dirname, "..", "public"), { maxAge: "1h" }));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return erro(res, 404, "Rota não encontrada.");
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.use((e, req, res, next) => {
  console.error("[erro]", e && e.stack ? e.stack : e);
  if (res.headersSent) return next(e);
  res.status(500).json({ erro: "Erro interno. Tente novamente." });
});

/* =====================================================================
   Sobe
   ===================================================================== */

const porta = Number(process.env.PORT || 3000);

(async () => {
  try {
    await um("SELECT 1 AS ok");
  } catch (e) {
    console.error(
      "\nNão foi possível conectar ao banco de dados.\n" +
        "Confira DB_HOST, DB_USER, DB_PASSWORD e DB_NAME no arquivo .env\n"
    );
    console.error(e.message);
    process.exit(1);
  }

  auth.limparSessoesVencidas().catch(() => {});
  setInterval(() => auth.limparSessoesVencidas().catch(() => {}), 60 * 60 * 1000).unref();

  app.listen(porta, () => {
    const admins = verificar();
    console.log("Controle de Montagens — Óticas Único");
    console.log("Servidor no ar em http://localhost:" + porta + "/");
    admins.then((n) => {
      if (n === 0) console.log("Nenhum administrador cadastrado: a primeira tela vai pedir a senha do Fred.");
    });
  });
})();
