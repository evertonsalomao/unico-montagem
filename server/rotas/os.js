"use strict";

const express = require("express");
const crypto = require("crypto");
const { q, um, transacao } = require("../db");
const P = require("../permissoes");

const rotas = express.Router();

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function texto(v, max) {
  return String(v == null ? "" : v).trim().slice(0, max);
}
function novoId() {
  return "os-" + Date.now().toString(36) + "-" + crypto.randomBytes(3).toString("hex");
}
function erro(res, codigo, mensagem) {
  return res.status(codigo).json({ erro: mensagem });
}

/** Monta o SELECT já recortado pelo perfil de quem pede. */
async function listar(usuario, filtros) {
  const onde = [];
  const args = [];

  if (!P.perfilDe(usuario).verTudo) {
    onde.push("o.loja = ?");
    args.push(usuario.loja);
  } else if (filtros.loja) {
    onde.push("o.loja = ?");
    args.push(filtros.loja);
  }
  if (filtros.de && DATA.test(filtros.de)) {
    onde.push("o.data_entrega >= ?");
    args.push(filtros.de);
  }
  if (filtros.ate && DATA.test(filtros.ate)) {
    onde.push("o.data_entrega <= ?");
    args.push(filtros.ate);
  }
  if (filtros.etapa && P.ETAPAS[filtros.etapa]) {
    onde.push("o.etapa = ?");
    args.push(filtros.etapa);
  }
  if (filtros.numero) {
    onde.push("o.numero_os LIKE ?");
    args.push("%" + texto(filtros.numero, 40) + "%");
  }
  if (filtros.vendedor) {
    onde.push("o.vendedor LIKE ?");
    args.push("%" + texto(filtros.vendedor, 120) + "%");
  }
  if (filtros.aberto === "1") onde.push("o.etapa <> 'finalizada'");

  const limite = Math.min(Number(filtros.limite) || 2000, 5000);
  const sql =
    "SELECT o.* FROM os o" +
    (onde.length ? " WHERE " + onde.join(" AND ") : "") +
    " ORDER BY o.data_entrega DESC, o.criado_em DESC LIMIT " + limite;
  return q(sql, args);
}

/* ----------------------------------------------------- listar / relatório */
rotas.get("/", async (req, res) => {
  const linhas = await listar(req.usuario, req.query);
  res.json({ os: linhas });
});

/* ------------------------------------------------------------- histórico */
rotas.get("/:id/historico", async (req, res) => {
  const os = await um("SELECT * FROM os WHERE id = ?", [req.params.id]);
  if (!os) return erro(res, 404, "OS não encontrada.");
  if (!P.alcanca(req.usuario, os)) return erro(res, 403, "Essa OS é de outra loja.");
  const trilha = await q(
    "SELECT etapa, em, por FROM os_historico WHERE os_id = ? ORDER BY em ASC, id ASC",
    [req.params.id]
  );
  res.json({ os: { id: os.id, numero_os: os.numero_os, loja: os.loja }, historico: trilha });
});

/* ------------------------------------------------------------- lançar OS */
rotas.post("/", async (req, res) => {
  const bloqueio = P.podeLancar(req.usuario);
  if (bloqueio) return erro(res, 403, bloqueio);

  const numero = texto(req.body.numero_os, 40);
  const vendedor = texto(req.body.vendedor, 120);
  const observacao = texto(req.body.observacao, 500);
  const entrega = texto(req.body.data_entrega, 10);
  const perfil = P.perfilDe(req.usuario);
  // A loja não escolhe a loja: vem travada do login dela.
  const loja = perfil.verTudo ? texto(req.body.loja, 80) : req.usuario.loja;

  if (!vendedor) return erro(res, 400, "Informe o vendedor.");
  if (!numero) return erro(res, 400, "Informe o número da OS.");
  if (!DATA.test(entrega)) return erro(res, 400, "Informe a data de entrega.");
  if (!loja) return erro(res, 400, "Selecione a loja.");

  const existe = await um("SELECT nome FROM lojas WHERE nome = ?", [loja]);
  if (!existe) return erro(res, 400, "Essa loja não está cadastrada.");

  const id = novoId();
  await transacao(async (conn) => {
    await conn.execute(
      `INSERT INTO os (id, numero_os, vendedor, loja, observacao, data_entrega,
                       etapa, criado_em, criado_por, etapa_em, etapa_por)
       VALUES (?, ?, ?, ?, ?, ?, 'aguardando', NOW(), ?, NOW(), ?)`,
      [id, numero, vendedor, loja, observacao || null, entrega, req.usuario.nome, req.usuario.nome]
    );
    await conn.execute(
      "INSERT INTO os_historico (os_id, etapa, em, por) VALUES (?, 'aguardando', NOW(), ?)",
      [id, req.usuario.nome]
    );
  });

  const criada = await um("SELECT * FROM os WHERE id = ?", [id]);
  res.status(201).json({ os: criada });
});

/* --------------------------------------------------------- alterar campos */
rotas.patch("/:id", async (req, res) => {
  const os = await um("SELECT * FROM os WHERE id = ?", [req.params.id]);
  if (!os) return erro(res, 404, "OS não encontrada.");
  const bloqueio = P.podeAlterar(req.usuario, os);
  if (bloqueio) return erro(res, 403, bloqueio);

  const numero = texto(req.body.numero_os, 40);
  const vendedor = texto(req.body.vendedor, 120);
  const observacao = texto(req.body.observacao, 500);
  const entrega = texto(req.body.data_entrega, 10);
  if (!vendedor || !numero) return erro(res, 400, "Vendedor e número da OS são obrigatórios.");
  if (!DATA.test(entrega)) return erro(res, 400, "Data de entrega inválida.");

  // Trocar a loja de uma OS é privilégio de quem vê todas as lojas.
  let loja = os.loja;
  if (P.perfilDe(req.usuario).verTudo && req.body.loja) {
    const nova = texto(req.body.loja, 80);
    const existe = await um("SELECT nome FROM lojas WHERE nome = ?", [nova]);
    if (!existe) return erro(res, 400, "Essa loja não está cadastrada.");
    loja = nova;
  }

  await q(
    `UPDATE os SET numero_os = ?, vendedor = ?, observacao = ?, data_entrega = ?, loja = ?
      WHERE id = ?`,
    [numero, vendedor, observacao || null, entrega, loja, os.id]
  );
  res.json({ os: await um("SELECT * FROM os WHERE id = ?", [os.id]) });
});

/* ------------------------------------------------------------ mudar etapa */
rotas.post("/:id/etapa", async (req, res) => {
  const os = await um("SELECT * FROM os WHERE id = ?", [req.params.id]);
  if (!os) return erro(res, 404, "OS não encontrada.");

  const destino = texto(req.body.etapa, 20);
  const bloqueio = P.podeEtapa(req.usuario, os, destino);
  if (bloqueio) return erro(res, 403, bloqueio);
  if (destino === os.etapa) return res.json({ os });

  await transacao(async (conn) => {
    const campos = ["etapa = ?", "etapa_em = NOW()", "etapa_por = ?"];
    const args = [destino, req.usuario.nome];
    if (destino === "montada") {
      campos.push("montada_em = NOW()", "montada_por = ?");
      args.push(req.usuario.nome);
    }
    if (destino === "finalizada") {
      campos.push("recebida_em = NOW()", "recebida_por = ?");
      args.push(req.usuario.nome);
    } else {
      // Sair de "recebida" limpa a marca da baixa.
      campos.push("recebida_em = NULL", "recebida_por = NULL");
    }
    args.push(os.id);
    await conn.execute("UPDATE os SET " + campos.join(", ") + " WHERE id = ?", args);
    await conn.execute(
      "INSERT INTO os_historico (os_id, etapa, em, por) VALUES (?, ?, NOW(), ?)",
      [os.id, destino, req.usuario.nome]
    );
  });

  res.json({ os: await um("SELECT * FROM os WHERE id = ?", [os.id]) });
});

/* ---------------------------------------------------------------- excluir */
rotas.delete("/:id", async (req, res) => {
  const os = await um("SELECT * FROM os WHERE id = ?", [req.params.id]);
  if (!os) return erro(res, 404, "OS não encontrada.");
  const bloqueio = P.podeExcluir(req.usuario, os);
  if (bloqueio) return erro(res, 403, bloqueio);
  // o histórico cai junto, por ON DELETE CASCADE
  await q("DELETE FROM os WHERE id = ?", [os.id]);
  res.json({ ok: true });
});

/* ------------------------------------------------------------ export CSV */
rotas.get("/exportar.csv", async (req, res) => {
  const linhas = await listar(req.usuario, req.query);
  const cabecalho = [
    "Data de entrega", "Hora do lancamento", "Vendedor", "Loja", "Numero da OS",
    "Observacao", "Etapa atual", "Etapa atualizada em", "Atualizada por",
    "Montagem finalizada em", "Recebido na loja em",
  ];
  const br = (v) => (v ? String(v).slice(0, 10).split("-").reverse().join("/") : "");
  const brh = (v) => {
    if (!v) return "";
    const s = String(v);
    return br(s) + " " + s.slice(11, 16);
  };
  const cel = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const saida = [cabecalho.map(cel).join(";")];
  linhas.forEach((o) => {
    saida.push([
      br(o.data_entrega), String(o.criado_em || "").slice(11, 16), o.vendedor, o.loja,
      o.numero_os, o.observacao || "", P.ETAPAS[o.etapa] ? P.ETAPAS[o.etapa].rotulo : o.etapa,
      brh(o.etapa_em), o.etapa_por || "", brh(o.montada_em), brh(o.recebida_em),
    ].map(cel).join(";"));
  });
  const hoje = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="montagens-' + hoje + '.csv"');
  res.send("﻿" + saida.join("\r\n"));
});

module.exports = rotas;
