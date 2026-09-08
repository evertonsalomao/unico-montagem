"use strict";

/** Lojas e acessos. Tudo aqui exige perfil de administrador. */

const express = require("express");
const { q, um } = require("../db");
const { gerarSegredo, derrubarSessoesDe } = require("../auth");
const P = require("../permissoes");

const rotas = express.Router();

function texto(v, max) {
  return String(v == null ? "" : v).trim().slice(0, max);
}
function erro(res, codigo, mensagem) {
  return res.status(codigo).json({ erro: mensagem });
}
function apelido(v) {
  return String(v == null ? "" : v)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

rotas.use((req, res, next) => {
  const bloqueio = P.podeGerenciar(req.usuario);
  if (bloqueio) return erro(res, 403, bloqueio);
  next();
});

/* -------------------------------------------------------------- lojas */
rotas.post("/lojas", async (req, res) => {
  const nome = texto(req.body.nome, 80);
  if (!nome) return erro(res, 400, "Informe o nome da loja.");
  const existe = await um("SELECT nome FROM lojas WHERE LOWER(nome) = LOWER(?)", [nome]);
  if (existe) return erro(res, 409, "Essa loja já está cadastrada.");
  const r = await um("SELECT IFNULL(MAX(ordem), -1) + 1 AS proxima FROM lojas");
  await q("INSERT INTO lojas (nome, ativa, ordem) VALUES (?, 1, ?)", [nome, r.proxima]);
  res.status(201).json({ ok: true, nome });
});

rotas.delete("/lojas/:nome", async (req, res) => {
  const nome = req.params.nome;
  const loja = await um("SELECT nome FROM lojas WHERE nome = ?", [nome]);
  if (!loja) return erro(res, 404, "Loja não encontrada.");

  // Loja com OS ou login vinculado não é apagada: fica inativa, para não
  // arrastar histórico embora nem quebrar as chaves estrangeiras.
  const comOs = await um("SELECT COUNT(*) AS total FROM os WHERE loja = ?", [nome]);
  const comLogin = await um("SELECT COUNT(*) AS total FROM usuarios WHERE loja = ?", [nome]);
  if (Number(comOs.total) > 0 || Number(comLogin.total) > 0) {
    await q("UPDATE lojas SET ativa = 0 WHERE nome = ?", [nome]);
    return res.json({
      ok: true,
      inativada: true,
      motivo:
        "A loja saiu da lista, mas foi mantida no banco: tem " +
        comOs.total + " OS e " + comLogin.total + " login vinculados.",
    });
  }
  await q("DELETE FROM lojas WHERE nome = ?", [nome]);
  res.json({ ok: true, inativada: false });
});

/* ------------------------------------------------------------ acessos */
rotas.get("/usuarios", async (req, res) => {
  const linhas = await q(
    `SELECT login, nome, perfil, loja, ativo, trocar_senha, criado_em, ultimo_acesso
       FROM usuarios
      ORDER BY FIELD(perfil, 'admin', 'lab', 'store'), nome`
  );
  res.json({ usuarios: linhas });
});

rotas.post("/usuarios", async (req, res) => {
  const perfil = texto(req.body.perfil, 10);
  const nome = texto(req.body.nome, 80);
  const login = apelido(req.body.login);
  const senha = String(req.body.senha || "");
  const loja = perfil === "store" ? texto(req.body.loja, 80) : null;

  if (!P.PERFIS[perfil]) return erro(res, 400, "Perfil inválido.");
  if (!nome) return erro(res, 400, "Informe o nome exibido.");
  if (login.length < 3) return erro(res, 400, "O login precisa ter no mínimo 3 caracteres.");
  if (senha.length < 6) return erro(res, 400, "A senha inicial precisa ter no mínimo 6 caracteres.");
  if (perfil === "store" && !loja) return erro(res, 400, "Selecione a loja deste acesso.");
  if (loja) {
    const existe = await um("SELECT nome FROM lojas WHERE nome = ?", [loja]);
    if (!existe) return erro(res, 400, "Essa loja não está cadastrada.");
  }
  const jaTem = await um("SELECT login FROM usuarios WHERE login = ?", [login]);
  if (jaTem) return erro(res, 409, "Esse login já existe.");

  const s = await gerarSegredo(senha);
  await q(
    `INSERT INTO usuarios (login, nome, perfil, loja, senha_hash, senha_sal, senha_iter,
                           ativo, trocar_senha, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, NOW())`,
    [login, nome, perfil, loja, s.hash, s.sal, s.rodadas]
  );
  res.status(201).json({ ok: true, login });
});

rotas.post("/usuarios/:login/senha", async (req, res) => {
  const login = req.params.login;
  const senha = String(req.body.senha || "");
  if (senha.length < 6) return erro(res, 400, "A senha precisa ter no mínimo 6 caracteres.");
  const alvo = await um("SELECT login FROM usuarios WHERE login = ?", [login]);
  if (!alvo) return erro(res, 404, "Login não encontrado.");
  const s = await gerarSegredo(senha);
  await q(
    "UPDATE usuarios SET senha_hash = ?, senha_sal = ?, senha_iter = ?, trocar_senha = 1 WHERE login = ?",
    [s.hash, s.sal, s.rodadas, login]
  );
  // quem estava logado com a senha antiga cai
  await derrubarSessoesDe(login);
  res.json({ ok: true });
});

rotas.post("/usuarios/:login/ativo", async (req, res) => {
  const login = req.params.login;
  if (login === req.usuario.login) return erro(res, 400, "Você não pode inativar o seu próprio acesso.");
  const alvo = await um("SELECT login, ativo FROM usuarios WHERE login = ?", [login]);
  if (!alvo) return erro(res, 404, "Login não encontrado.");
  const ativo = req.body.ativo ? 1 : 0;
  await q("UPDATE usuarios SET ativo = ? WHERE login = ?", [ativo, login]);
  if (!ativo) await derrubarSessoesDe(login);
  res.json({ ok: true, ativo: !!ativo });
});

rotas.delete("/usuarios/:login", async (req, res) => {
  const login = req.params.login;
  if (login === req.usuario.login) return erro(res, 400, "Você não pode excluir o seu próprio acesso.");
  const alvo = await um("SELECT login, perfil FROM usuarios WHERE login = ?", [login]);
  if (!alvo) return erro(res, 404, "Login não encontrado.");
  if (alvo.perfil === "admin") {
    const r = await um("SELECT COUNT(*) AS total FROM usuarios WHERE perfil = 'admin' AND ativo = 1");
    if (Number(r.total) <= 1) return erro(res, 400, "Este é o último administrador ativo.");
  }
  // as sessões caem por ON DELETE CASCADE; as OS lançadas por ele ficam
  await q("DELETE FROM usuarios WHERE login = ?", [login]);
  res.json({ ok: true });
});

module.exports = rotas;
