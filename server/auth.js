"use strict";

/**
 * Autenticação por usuário e senha, validada NO SERVIDOR.
 *
 * A senha nunca é guardada em texto. Guardamos o resultado de
 * PBKDF2-SHA256 com 150.000 rodadas e um sal aleatório por usuário —
 * exatamente o mesmo formato usado antes da migração, então todas as
 * senhas em uso continuam valendo.
 */

const crypto = require("crypto");
const { q, um } = require("./db");

const RODADAS = 150000;
const COOKIE = "montagens_sessao";
const HORAS = Number(process.env.SESSION_HOURS || 12);

function derivar(senha, salHex, rodadas) {
  return new Promise((ok, erro) => {
    crypto.pbkdf2(
      Buffer.from(String(senha), "utf8"),
      Buffer.from(salHex, "hex"),
      Number(rodadas) || RODADAS,
      32,
      "sha256",
      (e, chave) => (e ? erro(e) : ok(chave.toString("hex")))
    );
  });
}

async function gerarSegredo(senha) {
  const sal = crypto.randomBytes(16).toString("hex");
  const hash = await derivar(senha, sal, RODADAS);
  return { sal, hash, rodadas: RODADAS };
}

async function conferirSenha(senha, usuario) {
  const calculado = await derivar(senha, usuario.senha_sal, usuario.senha_iter);
  const a = Buffer.from(calculado, "hex");
  const b = Buffer.from(usuario.senha_hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/* Sessão: id aleatório guardado na tabela `sessoes` e assinado no    */
/* cookie. Apagar a linha no banco derruba o acesso na hora.          */
/* ------------------------------------------------------------------ */

function segredo() {
  const s = process.env.SESSION_SECRET || "";
  if (s.length < 16) {
    throw new Error(
      "SESSION_SECRET ausente ou curto demais. Gere um com:\n" +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return s;
}

function assinar(valor) {
  return crypto.createHmac("sha256", segredo()).update(valor).digest("base64url");
}

function empacotar(id) {
  return id + "." + assinar(id);
}

function desempacotar(bruto) {
  if (!bruto || typeof bruto !== "string") return null;
  const corte = bruto.lastIndexOf(".");
  if (corte < 1) return null;
  const id = bruto.slice(0, corte);
  const assinatura = bruto.slice(corte + 1);
  const esperada = assinar(id);
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

function opcoesCookie(req) {
  const seguro =
    String(process.env.COOKIE_SECURE || "true").toLowerCase() === "true" || req.secure === true;
  return {
    httpOnly: true,
    path: "/",
    // `SameSite=None` só é aceito pelos navegadores em conexão segura.
    // Em HTTP usamos `Lax`, senão o navegador descarta o cookie e o
    // login nunca completa.
    sameSite: seguro ? "none" : "lax",
    secure: seguro,
    maxAge: HORAS * 3600 * 1000,
  };
}

async function abrirSessao(req, res, login) {
  const id = crypto.randomBytes(32).toString("hex");
  await q(
    "INSERT INTO sessoes (id, login, criada_em, expira_em) VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? HOUR))",
    [id, login, HORAS]
  );
  await q("UPDATE usuarios SET ultimo_acesso = NOW() WHERE login = ?", [login]);
  res.cookie(COOKIE, empacotar(id), opcoesCookie(req));
  return id;
}

async function fecharSessao(req, res) {
  const id = desempacotar(req.cookies ? req.cookies[COOKIE] : null);
  if (id) await q("DELETE FROM sessoes WHERE id = ?", [id]);
  const opcoes = opcoesCookie(req);
  delete opcoes.maxAge;
  res.clearCookie(COOKIE, opcoes);
}

async function usuarioDaSessao(req) {
  const id = desempacotar(req.cookies ? req.cookies[COOKIE] : null);
  if (!id) return null;
  const linha = await um(
    `SELECT u.login, u.nome, u.perfil, u.loja, u.ativo, u.trocar_senha,
            u.senha_hash, u.senha_sal, u.senha_iter
       FROM sessoes s
       JOIN usuarios u ON u.login = s.login
      WHERE s.id = ? AND s.expira_em > NOW()`,
    [id]
  );
  if (!linha || !linha.ativo) return null;
  return linha;
}

async function limparSessoesVencidas() {
  await q("DELETE FROM sessoes WHERE expira_em <= NOW()");
}

async function derrubarSessoesDe(login) {
  await q("DELETE FROM sessoes WHERE login = ?", [login]);
}

module.exports = {
  COOKIE,
  RODADAS,
  derivar,
  gerarSegredo,
  conferirSenha,
  abrirSessao,
  fecharSessao,
  usuarioDaSessao,
  limparSessoesVencidas,
  derrubarSessoesDe,
};
