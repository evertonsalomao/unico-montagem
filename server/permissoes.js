"use strict";

/**
 * Regras de perfil. Esta é a fonte única da verdade e roda NO SERVIDOR:
 * a interface esconde o que o usuário não pode fazer, mas quem decide é
 * este arquivo. Nenhuma rota confia no que o navegador manda.
 */

const ETAPAS = {
  aguardando: { rotulo: "Aguardando", lab: true },
  montagem: { rotulo: "Em montagem", lab: true },
  coloracao: { rotulo: "Coloração", lab: true },
  montada: { rotulo: "Montagem finalizada", lab: true },
  finalizada: { rotulo: "Recebido na loja", lab: false },
};

const ORDEM_ETAPAS = ["aguardando", "montagem", "coloracao", "montada", "finalizada"];
const ETAPAS_LAB = ORDEM_ETAPAS.filter((k) => ETAPAS[k].lab);

const PERFIS = {
  admin: {
    rotulo: "Administrador",
    verTudo: true,
    lancar: true,
    etapas: ORDEM_ETAPAS,
    receber: true,
    alterar: true,
    excluir: true,
    gerenciar: true,
    mexerEmRecebida: true,
  },
  lab: {
    rotulo: "Laboratório",
    verTudo: true,
    lancar: false,
    etapas: ETAPAS_LAB,
    receber: false,
    alterar: false,
    excluir: false,
    gerenciar: false,
    mexerEmRecebida: false,
  },
  store: {
    rotulo: "Loja",
    verTudo: false,
    lancar: true,
    etapas: [],
    receber: true,
    alterar: true,
    // A loja NÃO exclui OS depois de lançada. Só altera.
    excluir: false,
    gerenciar: false,
    mexerEmRecebida: false,
  },
};

function perfilDe(usuario) {
  return PERFIS[usuario && usuario.perfil] || PERFIS.store;
}

/** A OS está no escopo de quem está pedindo? */
function alcanca(usuario, os) {
  const p = perfilDe(usuario);
  if (p.verTudo) return true;
  return os.loja === usuario.loja;
}

/** Pode mudar a etapa desta OS para `destino`? */
function podeEtapa(usuario, os, destino) {
  const p = perfilDe(usuario);
  if (!ETAPAS[destino]) return "Etapa desconhecida.";
  if (!alcanca(usuario, os)) return "Essa OS é de outra loja.";
  if (os.etapa === "finalizada" && !p.mexerEmRecebida) {
    return "Esta OS já foi recebida na loja.";
  }
  const liberadas = p.etapas.slice();
  if (destino === "finalizada" && p.receber && liberadas.indexOf("finalizada") === -1) {
    liberadas.push("finalizada");
  }
  if (liberadas.indexOf(destino) === -1) {
    return 'Seu perfil não pode marcar "' + ETAPAS[destino].rotulo + '".';
  }
  return null;
}

/** Pode editar os campos desta OS? */
function podeAlterar(usuario, os) {
  const p = perfilDe(usuario);
  if (!p.alterar) return "Seu perfil não altera OS.";
  if (!alcanca(usuario, os)) return "Essa OS é de outra loja.";
  if (os.etapa === "finalizada" && !p.mexerEmRecebida) {
    return "Esta OS já foi recebida e não pode mais ser alterada.";
  }
  return null;
}

/** Pode excluir esta OS? */
function podeExcluir(usuario, os) {
  const p = perfilDe(usuario);
  if (!p.excluir) return "Seu perfil não exclui OS.";
  if (!alcanca(usuario, os)) return "Essa OS é de outra loja.";
  return null;
}

function podeLancar(usuario) {
  return perfilDe(usuario).lancar ? null : "Seu perfil não lança OS.";
}

function podeGerenciar(usuario) {
  return perfilDe(usuario).gerenciar ? null : "Apenas o administrador faz isso.";
}

/** Recorte que a interface recebe, para desenhar só o que é permitido. */
function resumo(usuario) {
  const p = perfilDe(usuario);
  return {
    login: usuario.login,
    nome: usuario.nome,
    perfil: usuario.perfil,
    rotuloPerfil: p.rotulo,
    loja: usuario.loja || "",
    trocarSenha: !!usuario.trocar_senha,
    permissoes: {
      verTudo: p.verTudo,
      lancar: p.lancar,
      etapas: p.etapas,
      receber: p.receber,
      alterar: p.alterar,
      excluir: p.excluir,
      gerenciar: p.gerenciar,
      mexerEmRecebida: p.mexerEmRecebida,
    },
  };
}

module.exports = {
  ETAPAS,
  ORDEM_ETAPAS,
  ETAPAS_LAB,
  PERFIS,
  perfilDe,
  alcanca,
  podeEtapa,
  podeAlterar,
  podeExcluir,
  podeLancar,
  podeGerenciar,
  resumo,
};
