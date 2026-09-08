/**
 * Controle de Montagens — Óticas Único
 * Interface. Toda a decisão de permissão é do servidor; aqui a gente só
 * desenha o que ele autorizou e mostra o erro que ele devolver.
 */
(function () {
  "use strict";

  var ETAPAS = {
    aguardando: { label: "Aguardando", cls: "wait", verb: "Aguardando desde" },
    montagem: { label: "Em montagem", cls: "work", verb: "Em montagem desde" },
    coloracao: { label: "Coloração", cls: "color", verb: "Em coloração desde" },
    montada: { label: "Montagem finalizada", cls: "sent", verb: "Montagem concluída" },
    finalizada: { label: "Recebido na loja", cls: "done", verb: "Recebido" },
  };
  var ORDEM = ["aguardando", "montagem", "coloracao", "montada", "finalizada"];
  /* Etapas que saíram do fluxo: seguem legíveis no histórico já gravado. */
  var ANTIGAS = {
    lente: { label: "Aguardando lente", cls: "block" },
    enviado: { label: "Enviado loja", cls: "sent" },
  };
  function metaEtapa(k) { return ETAPAS[k] || ANTIGAS[k] || ETAPAS.aguardando; }

  var TABS = [
    { key: "lancar", label: "Lançar OS" },
    { key: "relatorios", label: "Relatórios" },
    { key: "lojas", label: "Lojas", admin: true },
    { key: "acessos", label: "Acessos", admin: true },
  ];
  var INTERVALO_ATUALIZACAO = 20000;

  var eu = null;
  var lojas = [];
  var itens = [];
  var usuarios = [];
  var carregado = false;
  var consulta = null;
  var editando = null;
  var aba = "lancar";
  var modoPortao = "login";
  var timerAtualiza = null;

  var $ = function (id) { return document.getElementById(id); };
  function perm() { return (eu && eu.permissoes) || {}; }

  /* ------------------------------------------------------ utilidades */
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function hojeISO() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function primeiroDoMes() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-01";
  }
  function brData(v) {
    if (!v) return "—";
    var p = String(v).slice(0, 10).split("-");
    return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : String(v);
  }
  /* O servidor devolve DATETIME como "AAAA-MM-DD HH:MM:SS" (hora local
     do servidor). Formatamos direto, sem passar por Date, para não
     deslocar o horário pelo fuso do navegador. */
  function brQuando(v) {
    if (!v) return "";
    var s = String(v);
    return brData(s) + " às " + s.slice(11, 16);
  }
  function soHora(v) { return v ? String(v).slice(11, 16) : "—"; }
  function dataLonga(iso) {
    var p = String(iso).slice(0, 10).split("-");
    if (p.length !== 3) return iso;
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]))
      .toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  }
  var timerToast = null;
  function toast(msg, ruim) {
    var el = $("toast");
    el.textContent = msg;
    el.className = "toast on" + (ruim ? " bad" : "");
    clearTimeout(timerToast);
    timerToast = setTimeout(function () { el.className = "toast"; }, 3800);
  }
  function etapaDe(it) { return ETAPAS[it.etapa] ? it.etapa : "aguardando"; }
  function apelido(v) {
    return String(v == null ? "" : v).trim().toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  }

  /* ------------------------------------------------------------- API */
  function api(caminho, opcoes) {
    var cfg = opcoes || {};
    var init = { method: cfg.method || "GET", credentials: "same-origin", headers: {} };
    if (cfg.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(cfg.body);
    }
    return fetch("/api" + caminho, init).then(function (r) {
      if (r.status === 401) {
        if (eu) { eu = null; pararAtualizacao(); mostrarPortao("login"); toast("Sua sessão expirou. Entre de novo.", true); }
        return Promise.reject({ codigo: 401, mensagem: "Faça login para continuar." });
      }
      return r.text().then(function (txt) {
        var dados = {};
        try { dados = txt ? JSON.parse(txt) : {}; } catch (e) { dados = {}; }
        if (!r.ok) return Promise.reject({ codigo: r.status, mensagem: dados.erro || "Não foi possível concluir." });
        return dados;
      });
    }, function () {
      return Promise.reject({ codigo: 0, mensagem: "Sem conexão com o servidor." });
    });
  }
  function falhou(e) { toast((e && e.mensagem) || "Não foi possível concluir.", true); }

  /* ----------------------------------------------------------- modal */
  var resolveModal = null;
  function fecharModal(valor) {
    $("modal").hidden = true;
    var fn = resolveModal;
    resolveModal = null;
    if (fn) fn(valor);
  }
  function perguntar(o) {
    return new Promise(function (resolve) {
      if (resolveModal) { resolve(null); return; }
      resolveModal = resolve;
      $("modalTitle").textContent = o.title || "";
      $("modalText").textContent = o.text || "";
      $("modalText").hidden = !o.text;
      $("modalCode").textContent = o.code || "";
      $("modalCode").hidden = !o.code;
      $("modalTrail").hidden = true;
      $("modalTrail").innerHTML = "";
      $("modalYes").textContent = o.confirmLabel || "Confirmar";
      $("modalNo").hidden = !!o.onlyOk;
      var temCampo = Object.prototype.hasOwnProperty.call(o, "value");
      $("modalField").hidden = !temCampo;
      if (temCampo) {
        $("modalLabel").textContent = o.label || "Valor";
        $("modalInput").value = o.value || "";
        $("modalInput").type = o.password ? "password" : "text";
      }
      $("modal").hidden = false;
      (temCampo ? $("modalInput") : $("modalYes")).focus();
      if (temCampo) $("modalInput").select();
    });
  }
  function aceitarModal() {
    if (!resolveModal) return;
    fecharModal($("modalField").hidden ? true : $("modalInput").value.trim());
  }
  $("modalYes").addEventListener("click", aceitarModal);
  $("modalNo").addEventListener("click", function () { fecharModal(null); });
  $("modal").addEventListener("click", function (ev) { if (ev.target === $("modal")) fecharModal(null); });
  $("modalInput").addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); aceitarModal(); } });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !$("modal").hidden) fecharModal(null); });

  /* ================================================================
     TELA DE ACESSO
     ================================================================ */
  function avisoPortao(t) { $("gateMsg").textContent = t || ""; }

  function mostrarPortao(modo) {
    modoPortao = modo;
    $("app").hidden = true;
    $("gate").hidden = false;
    $("gateForm").hidden = false;
    avisoPortao("");
    $("gatePass").value = "";
    $("gatePass2").value = "";
    if (modo === "instalar") {
      $("gateTag").textContent = "Primeiro acesso";
      $("gateTitle").innerHTML = "Defina a senha do <em>administrador</em>";
      $("gateSub").textContent = "O login administrativo é fred. Escolha a senha que só você vai usar — depois você cria os acessos das lojas e do laboratório.";
      $("gateUserField").hidden = true;
      $("gatePassLabel").textContent = "Nova senha";
      $("gatePass").placeholder = "Mínimo 6 caracteres";
      $("gatePass").setAttribute("autocomplete", "new-password");
      $("gatePass2Field").hidden = false;
      $("gateBtn").textContent = "Criar administrador";
      $("gateNote").innerHTML = "Guarde esta senha. <strong>Ninguém consegue recuperá-la</strong> — só criar outro administrador.";
    } else if (modo === "trocar") {
      $("gateTag").textContent = "Troca obrigatória";
      $("gateTitle").innerHTML = "Crie a sua <em>senha</em>";
      $("gateSub").textContent = "Você entrou com a senha inicial. Defina uma senha só sua para continuar.";
      $("gateUserField").hidden = true;
      $("gatePassLabel").textContent = "Nova senha";
      $("gatePass").placeholder = "Mínimo 6 caracteres";
      $("gatePass").setAttribute("autocomplete", "new-password");
      $("gatePass2Field").hidden = false;
      $("gateBtn").textContent = "Salvar e entrar";
      $("gateNote").innerHTML = "Entrando como <strong>" + esc(eu ? eu.nome : "") + "</strong>.";
    } else {
      $("gateTag").textContent = "Acesso restrito";
      $("gateTitle").innerHTML = "Controle de <em>montagens</em>";
      $("gateSub").textContent = "Entre com o login da sua loja para registrar e acompanhar as OS.";
      $("gateUserField").hidden = false;
      $("gatePassLabel").textContent = "Senha";
      $("gatePass").placeholder = "Digite sua senha";
      $("gatePass").setAttribute("autocomplete", "current-password");
      $("gatePass2Field").hidden = true;
      $("gateBtn").textContent = "Entrar no sistema";
      $("gateNote").innerHTML = "Óticas Único &nbsp;·&nbsp; Operação interna";
      setTimeout(function () { $("gateUser").focus(); }, 60);
    }
  }

  $("gateForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var btn = $("gateBtn");
    var senha = $("gatePass").value;

    if (modoPortao === "instalar" || modoPortao === "trocar") {
      if (senha.length < 6) { avisoPortao("A senha precisa ter no mínimo 6 caracteres."); return; }
      if (senha !== $("gatePass2").value) { avisoPortao("As duas senhas não são iguais."); return; }
      btn.disabled = true;
      avisoPortao("");
      var req = modoPortao === "instalar"
        ? api("/instalar", { method: "POST", body: { senha: senha } })
        : api("/primeira-senha", { method: "POST", body: { nova: senha } });
      req.then(function () {
        btn.disabled = false;
        toast(modoPortao === "instalar" ? "Administrador criado. Bem-vindo, Fred." : "Senha definida.");
        return entrarNoSistema();
      }).catch(function (e) { btn.disabled = false; avisoPortao(e.mensagem || "Não foi possível salvar."); });
      return;
    }

    var login = apelido($("gateUser").value);
    if (!login || !senha) { avisoPortao("Informe o usuário e a senha."); return; }
    btn.disabled = true;
    avisoPortao("Verificando…");
    api("/login", { method: "POST", body: { login: login, senha: senha } })
      .then(function (r) {
        btn.disabled = false;
        avisoPortao("");
        $("gatePass").value = "";
        eu = r.eu;
        if (eu.trocarSenha) { mostrarPortao("trocar"); return; }
        return entrarNoSistema();
      })
      .catch(function (e) { btn.disabled = false; avisoPortao(e.mensagem || "Usuário ou senha inválidos."); });
  });

  $("btnOut").addEventListener("click", function () {
    api("/logout", { method: "POST" }).catch(function () {}).then(function () {
      eu = null; itens = []; usuarios = []; consulta = null; editando = null;
      pararAtualizacao();
      mostrarPortao("login");
      toast("Você saiu do sistema.");
    });
  });

  $("btnPass").addEventListener("click", function () {
    perguntar({ title: "Senha atual", text: "Confirme a senha que você usa hoje.", label: "Senha atual", value: "", password: true, confirmLabel: "Continuar" })
      .then(function (atual) {
        if (!atual) return null;
        return perguntar({ title: "Nova senha", text: "Mínimo de 6 caracteres.", label: "Nova senha", value: "", password: true, confirmLabel: "Salvar senha" })
          .then(function (nova) {
            if (!nova) return null;
            return api("/senha", { method: "POST", body: { atual: atual, nova: nova } })
              .then(function () { toast("Senha alterada."); });
          });
      })
      .catch(falhou);
  });

  /* ================================================================
     DADOS
     ================================================================ */
  function entrarNoSistema() {
    return api("/inicio").then(function (r) {
      eu = r.eu;
      lojas = r.lojas || [];
      itens = r.os || [];
      carregado = true;
      $("gate").hidden = true;
      $("app").hidden = false;
      montarFiltroEtapa();
      desenharTudo();
      if (perm().gerenciar) carregarUsuarios();
      iniciarAtualizacao();
    });
  }
  function recarregar(silencioso) {
    return api("/inicio").then(function (r) {
      eu = r.eu;
      lojas = r.lojas || [];
      itens = r.os || [];
      carregado = true;
      desenharTudo();
      if (perm().gerenciar) carregarUsuarios();
    }).catch(function (e) { if (!silencioso) falhou(e); });
  }
  function carregarUsuarios() {
    return api("/admin/usuarios").then(function (r) {
      usuarios = r.usuarios || [];
      desenharUsuarios();
    }).catch(function () {});
  }
  function iniciarAtualizacao() {
    pararAtualizacao();
    timerAtualiza = setInterval(function () {
      if (document.hidden || !eu || editando || resolveModal) return;
      recarregar(true);
    }, INTERVALO_ATUALIZACAO);
  }
  function pararAtualizacao() {
    if (timerAtualiza) clearInterval(timerAtualiza);
    timerAtualiza = null;
  }

  function ordenar(lista) {
    return lista.slice().sort(function (a, b) {
      var ka = String(a.data_entrega || "") + String(a.criado_em || "");
      var kb = String(b.data_entrega || "") + String(b.criado_em || "");
      return ka < kb ? 1 : ka > kb ? -1 : 0;
    });
  }
  function combina(it, c) {
    var st = etapaDe(it);
    var entrega = String(it.data_entrega || "").slice(0, 10);
    if (c.de && entrega < c.de) return false;
    if (c.ate && entrega > c.ate) return false;
    if (c.loja && it.loja !== c.loja) return false;
    if (c.etapa && st !== c.etapa) return false;
    if (c.numero && String(it.numero_os || "").toLowerCase().indexOf(c.numero.toLowerCase()) === -1) return false;
    if (c.vendedor && String(it.vendedor || "").toLowerCase().indexOf(c.vendedor.toLowerCase()) === -1) return false;
    return true;
  }
  function podeMexer(it) {
    var p = perm();
    if (!p.alterar) return false;
    if (!p.verTudo && it.loja !== eu.loja) return false;
    if (etapaDe(it) === "finalizada" && !p.mexerEmRecebida) return false;
    return true;
  }

  /* ================================================================
     DESENHO
     ================================================================ */
  function desenharTopo() {
    var p = perm();
    $("whoName").textContent = eu.nome;
    $("whoRole").textContent = eu.rotuloPerfil;
    $("whoRole").className = eu.perfil === "admin" ? "adm" : "";
    var h = new Date().getHours();
    $("hello").textContent = (h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite") + ", " + eu.nome;
    $("scopeNote").textContent = p.verTudo
      ? "Você acompanha as ordens de serviço de todas as lojas."
      : "Você vê e registra as ordens de serviço da loja " + eu.loja + ".";
    $("openSub").textContent = p.verTudo
      ? "Todas as lojas — tudo que ainda não foi recebido"
      : (p.etapas && p.etapas.length ? "Etapa de cada OS" : "Acompanhe a etapa de cada OS");

    var liberadas = TABS.filter(function (t) { return !t.admin || p.gerenciar; });
    if (!liberadas.some(function (t) { return t.key === aba; })) aba = liberadas[0].key;
    $("tabs").innerHTML = liberadas.map(function (t) {
      var rotulo = t.key === "lancar" && !p.lancar ? "Acompanhar" : t.label;
      return '<button role="tab" type="button" id="tab-' + t.key + '" data-tab="' + t.key +
        '" aria-selected="' + (t.key === aba ? "true" : "false") + '">' + esc(rotulo) + "</button>";
    }).join("");
    ["lancar", "relatorios", "lojas", "acessos"].forEach(function (k) {
      $("panel-" + k).className = "panel" + (k === aba ? " on" : "");
    });
    $("launchCols").className = "cols" + (p.lancar ? "" : " solo");
    $("launchCard").hidden = !p.lancar;
    $("qStoreField").hidden = !p.verTudo;
  }

  function desenharPlacar() {
    var conta = { aguardando: 0, montagem: 0, coloracao: 0, montada: 0, finalizada: 0 };
    var aberto = 0, recebidasMes = 0;
    var mes = primeiroDoMes().slice(0, 7);
    itens.forEach(function (it) {
      var st = etapaDe(it);
      conta[st] = (conta[st] || 0) + 1;
      if (st !== "finalizada") aberto++;
      else if (String(it.recebida_em || "").slice(0, 7) === mes) recebidasMes++;
    });
    $("tiles").innerHTML =
      bloco("all", "Em aberto", aberto, "ainda não recebidas") +
      bloco("wait", "Aguardando", conta.aguardando, "na fila do laboratório") +
      bloco("work", "Em montagem", conta.montagem + conta.coloracao, "montagem + coloração") +
      bloco("sent", "Montagem finalizada", conta.montada, "prontas para a loja") +
      bloco("done", "Recebidas no mês", recebidasMes, "baixas concluídas");
  }
  function bloco(cls, rotulo, n, nota) {
    return '<div class="tile ' + cls + '"><span>' + esc(rotulo) + '</span><strong class="tnum">' + n +
      '</strong><small>' + esc(nota) + "</small></div>";
  }

  function desenharLojas() {
    var p = perm();
    var opcoes = ['<option value="">Selecione a loja</option>'];
    lojas.forEach(function (s) { opcoes.push('<option value="' + esc(s) + '">' + esc(s) + "</option>"); });
    var mantem = $("fStore").value;
    if (p.verTudo) {
      $("fStore").innerHTML = opcoes.join("");
      $("fStore").disabled = false;
      $("fStoreNote").hidden = true;
      if (mantem && lojas.indexOf(mantem) > -1) $("fStore").value = mantem;
    } else {
      $("fStore").innerHTML = '<option value="' + esc(eu.loja) + '">' + esc(eu.loja) + "</option>";
      $("fStore").value = eu.loja;
      $("fStore").disabled = true;
      $("fStoreNote").hidden = false;
      $("fStoreNote").textContent = "Fixa no seu login.";
    }
    var fq = ['<option value="">Todas as lojas</option>'];
    lojas.forEach(function (s) { fq.push('<option value="' + esc(s) + '">' + esc(s) + "</option>"); });
    var mantemQ = $("qStore").value;
    $("qStore").innerHTML = fq.join("");
    if (mantemQ && lojas.indexOf(mantemQ) > -1) $("qStore").value = mantemQ;

    var mantemU = $("uStore").value;
    $("uStore").innerHTML = lojas.map(function (s) {
      return '<option value="' + esc(s) + '">' + esc(s) + "</option>";
    }).join("");
    if (mantemU && lojas.indexOf(mantemU) > -1) $("uStore").value = mantemU;

    $("storeCount").textContent = lojas.length + (lojas.length === 1 ? " loja" : " lojas");
    $("storeList").innerHTML = lojas.length
      ? lojas.map(function (s) {
          return '<span class="store">' + esc(s) +
            '<button type="button" data-store="' + esc(s) + '" aria-label="Remover ' + esc(s) + '">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"></path></svg>' +
            "</button></span>";
        }).join("")
      : '<p class="form-note">Nenhuma loja cadastrada. Adicione a primeira acima.</p>';
  }

  function desenharAbertas() {
    var abertas = ordenar(itens).filter(function (it) { return etapaDe(it) !== "finalizada"; });
    $("openCount").textContent = abertas.length ? abertas.length + " em aberto" : "";
    if (!carregado) { $("openList").innerHTML = '<p class="form-note">Carregando lançamentos…</p>'; return; }
    if (!abertas.length) { $("openList").innerHTML = vazio("Nenhuma OS em aberto. Tudo recebido por aqui."); return; }
    $("openList").innerHTML = '<div class="rows">' + abertas.map(linhaHtml).join("") + "</div>";
  }
  function vazio(msg) {
    return '<div class="empty"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="4" y="4" width="16" height="17" rx="2"></rect><path d="M8 11h8M8 15.5h5"></path></svg><p>' + esc(msg) + "</p></div>";
  }
  function selo(it) {
    var st = etapaDe(it);
    var meta = ETAPAS[st];
    var quando = st === "finalizada" ? (it.recebida_em || it.etapa_em || it.criado_em)
      : st === "montada" ? (it.montada_em || it.etapa_em || it.criado_em)
      : (it.etapa_em || it.criado_em);
    var quem = st === "finalizada" ? (it.recebida_por || it.etapa_por)
      : st === "montada" ? (it.montada_por || it.etapa_por)
      : (it.etapa_por || it.criado_por);
    return meta.verb + " " + (brQuando(quando) || brData(it.data_entrega)) + (quem ? " · " + quem : "");
  }
  function linhaHtml(it) {
    var st = etapaDe(it);
    var meta = ETAPAS[st];
    return '<div class="row ' + meta.cls + '">' +
      '<span class="row-os"><b class="tnum">OS ' + esc(it.numero_os) + "</b><span>" + esc(it.vendedor || "—") + "</span></span>" +
      '<span class="row-meta"><b>' + esc(it.loja || "—") + "</b><span>entrega " + brData(it.data_entrega) + "</span></span>" +
      '<span class="row-obs">' + (it.observacao ? esc(it.observacao) : "") + "</span>" +
      '<span class="row-side">' +
        '<span class="chip ' + meta.cls + '">' + esc(meta.label) + "</span>" +
        '<span class="stamp">' + esc(selo(it)) + "</span>" +
        '<button class="histlink" data-hist="' + esc(it.id) + '" type="button">histórico</button>' +
        acoesHtml(it, st) +
      "</span>" +
      (editando === it.id ? edicaoHtml(it) : "") +
      "</div>";
  }
  function acoesHtml(it, st) {
    var p = perm();
    var minha = p.verTudo || it.loja === eu.loja;
    var etapas = (p.etapas || []).slice();
    var out = "";
    if (etapas.length && minha && (st !== "finalizada" || p.mexerEmRecebida)) {
      out += '<select class="pick" data-pick="' + esc(it.id) + '" aria-label="Etapa da OS ' + esc(it.numero_os) + '">' +
        etapas.map(function (k) {
          return '<option value="' + k + '"' + (k === st ? " selected" : "") + ">" + esc(ETAPAS[k].label) + "</option>";
        }).join("") +
        (etapas.indexOf(st) === -1 ? '<option value="' + st + '" selected>' + esc(ETAPAS[st].label) + "</option>" : "") +
        "</select>";
    }
    if (st !== "finalizada" && p.receber && minha && !etapas.length) {
      out += '<button class="act strong" data-done="' + esc(it.id) + '" type="button">Recebido na loja</button>';
    }
    if (podeMexer(it)) {
      out += '<button class="act" data-edit="' + esc(it.id) + '" type="button">Alterar</button>';
      if (p.excluir) out += '<button class="act" data-del="' + esc(it.id) + '" type="button">Excluir</button>';
    }
    return out;
  }
  function edicaoHtml(it) {
    var p = perm();
    var campoLoja = p.verTudo
      ? '<select class="ctl" data-f="loja">' + lojas.map(function (s) {
          return '<option value="' + esc(s) + '"' + (s === it.loja ? " selected" : "") + ">" + esc(s) + "</option>";
        }).join("") +
        (lojas.indexOf(it.loja) === -1 && it.loja ? '<option value="' + esc(it.loja) + '" selected>' + esc(it.loja) + "</option>" : "") +
        "</select>"
      : '<input class="ctl" value="' + esc(it.loja) + '" disabled>';
    return '<div class="edit" data-form="' + esc(it.id) + '">' +
      '<div class="pair">' +
        '<label class="fld"><span>Vendedor</span><input class="ctl" data-f="vendedor" value="' + esc(it.vendedor || "") + '" maxlength="120"></label>' +
        '<label class="fld"><span>Número da OS</span><input class="ctl tnum" data-f="numero_os" value="' + esc(it.numero_os || "") + '" maxlength="40"></label>' +
      "</div>" +
      '<div class="pair">' +
        '<label class="fld"><span>Loja</span>' + campoLoja + "</label>" +
        '<label class="fld"><span>Data de entrega</span><input class="ctl tnum" data-f="data_entrega" type="date" value="' + esc(String(it.data_entrega || "").slice(0, 10)) + '"></label>' +
      "</div>" +
      '<label class="fld"><span>Observação</span><textarea class="ctl" data-f="observacao" maxlength="500">' + esc(it.observacao || "") + "</textarea></label>" +
      '<div class="edit-row">' +
        '<button class="act" data-cancel="1" type="button">Cancelar</button>' +
        '<button class="act strong" data-save="' + esc(it.id) + '" type="button">Salvar alterações</button>' +
      "</div>" +
    "</div>";
  }

  function montarFiltroEtapa() {
    var p = perm();
    var doLab = (p.etapas && p.etapas.length ? p.etapas : ORDEM).filter(function (k) { return k !== "finalizada"; });
    function opcoes(chaves) {
      return chaves.map(function (k) {
        return '<option value="' + k + '">' + esc(ETAPAS[k].label) + "</option>";
      }).join("");
    }
    $("qStatus").innerHTML = '<option value="">Todas as etapas</option>' +
      '<optgroup label="Laboratório">' + opcoes(doLab) + "</optgroup>" +
      '<optgroup label="Loja">' + opcoes(["finalizada"]) + "</optgroup>";
  }

  function desenharRelatorio() {
    if (!consulta) { $("reportBody").innerHTML = ""; $("reportTotals").innerHTML = ""; return; }
    var linhas = ordenar(itens).filter(function (it) { return combina(it, consulta); });
    $("reportTotal").textContent = linhas.length;

    var partes = [];
    if (consulta.de || consulta.ate) {
      partes.push((consulta.de ? dataLonga(consulta.de) : "início") + " até " + (consulta.ate ? dataLonga(consulta.ate) : "hoje"));
    }
    if (!perm().verTudo) partes.push("loja " + eu.loja);
    else if (consulta.loja) partes.push("loja " + consulta.loja);
    if (consulta.etapa) partes.push("etapa " + metaEtapa(consulta.etapa).label.toLowerCase());
    if (consulta.numero) partes.push("OS contendo “" + consulta.numero + "”");
    if (consulta.vendedor) partes.push("vendedor “" + consulta.vendedor + "”");
    $("reportRange").textContent = partes.length ? partes.join(" · ") : "Todos os lançamentos registrados";

    var porLoja = {};
    linhas.forEach(function (it) {
      var k = it.loja || "Sem loja";
      porLoja[k] = (porLoja[k] || 0) + 1;
    });
    var chaves = Object.keys(porLoja).sort(function (a, b) { return porLoja[b] - porLoja[a] || a.localeCompare(b, "pt-BR"); });
    $("reportTotals").innerHTML = chaves.map(function (k) {
      return '<div class="total"><span>' + esc(k) + '</span><strong class="tnum">' + porLoja[k] + "</strong></div>";
    }).join("");

    if (!linhas.length) {
      $("reportBody").innerHTML = '<div class="tablewrap">' + vazio("Nenhuma OS encontrada com esses filtros.") + "</div>";
      return;
    }
    $("reportBody").innerHTML = '<div class="tablewrap"><table><thead><tr>' +
      "<th>Entrega</th><th>Hora</th><th>Vendedor</th><th>Loja</th><th>Nº da OS</th><th>Observação</th><th>Etapa</th><th>Ações</th>" +
      "</tr></thead><tbody>" + linhas.map(function (it) {
        var st = etapaDe(it);
        var meta = ETAPAS[st];
        return '<tr class="' + meta.cls + '">' +
          '<td class="stripe tnum">' + brData(it.data_entrega) + "</td>" +
          '<td class="tnum">' + soHora(it.criado_em) + "</td>" +
          "<td><b>" + esc(it.vendedor || "—") + "</b></td>" +
          "<td><b>" + esc(it.loja || "—") + "</b></td>" +
          '<td class="tnum"><b>' + esc(it.numero_os) + "</b></td>" +
          '<td><span class="obs">' + (it.observacao ? esc(it.observacao) : "—") + "</span></td>" +
          '<td><span class="chip ' + meta.cls + '">' + esc(meta.label) + '</span><span class="stamp" style="display:block;margin-top:5px">' +
            esc(selo(it)) + '</span><button class="histlink" data-hist="' + esc(it.id) + '" type="button" style="margin-top:4px">histórico</button></td>' +
          '<td><span class="acts">' + acoesHtml(it, st) + "</span></td>" +
          "</tr>" + (editando === it.id ? '<tr><td colspan="8">' + edicaoHtml(it) + "</td></tr>" : "");
      }).join("") + "</tbody></table></div>";
  }

  function desenharUsuarios() {
    if (!perm().gerenciar) return;
    $("userCount").textContent = usuarios.length + (usuarios.length === 1 ? " acesso" : " acessos");
    var faltando = lojas.filter(function (s) {
      return !usuarios.some(function (u) { return u.perfil === "store" && u.loja === s; });
    });
    var temLab = usuarios.some(function (u) { return u.perfil === "lab"; });
    $("seedBox").innerHTML = (faltando.length || !temLab)
      ? '<div class="banner info" style="margin-top:18px">' +
        (faltando.length ? faltando.length + (faltando.length === 1 ? " loja ainda não tem" : " lojas ainda não têm") + " login" : "") +
        (faltando.length && !temLab ? " e o " : "") +
        (!temLab ? "laboratório ainda não tem acesso" : "") + ". " +
        '<button class="act" id="seedBtn" type="button" style="margin-left:8px">Criar acessos que faltam</button></div>'
      : "";

    if (!usuarios.length) { $("userList").innerHTML = vazio("Nenhum acesso criado ainda."); return; }
    $("userList").innerHTML = '<div class="tablewrap"><table class="users"><thead><tr>' +
      "<th>Nome</th><th>Login</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th>Ações</th>" +
      "</tr></thead><tbody>" + usuarios.map(function (u) {
        var souEu = u.login === eu.login;
        var rotulos = { admin: "Administrador", lab: "Laboratório", store: "Loja" };
        return "<tr>" +
          "<td><b>" + esc(u.nome) + "</b>" + (u.perfil === "store" && u.loja ? '<span class="obs">' + esc(u.loja) + "</span>" : "") + "</td>" +
          "<td>" + esc(u.login) + "</td>" +
          "<td>" + esc(rotulos[u.perfil] || u.perfil) + "</td>" +
          '<td><span class="chip ' + (u.ativo ? "on" : "off") + '">' + (u.ativo ? "Ativo" : "Inativo") + "</span>" +
            (u.trocar_senha ? '<span class="stamp" style="display:block;margin-top:5px">senha inicial</span>' : "") + "</td>" +
          '<td><span class="stamp">' + (u.ultimo_acesso ? esc(brQuando(u.ultimo_acesso)) : "nunca entrou") + "</span></td>" +
          '<td><span class="acts">' +
            '<button class="act" data-reset="' + esc(u.login) + '" type="button">Nova senha</button>' +
            (souEu ? "" :
              '<button class="act" data-toggle="' + esc(u.login) + '" type="button">' + (u.ativo ? "Inativar" : "Ativar") + "</button>" +
              '<button class="act" data-userdel="' + esc(u.login) + '" type="button">Excluir</button>') +
          "</span></td>" +
          "</tr>";
      }).join("") + "</tbody></table></div>";
  }

  function desenharTudo() {
    if (!eu) return;
    $("dbState").textContent = "Óticas Único · servidor próprio";
    $("docState").textContent = itens.length + (itens.length === 1 ? " OS no seu alcance" : " OS no seu alcance");
    desenharTopo();
    desenharPlacar();
    desenharLojas();
    desenharAbertas();
    desenharRelatorio();
    desenharUsuarios();
  }

  /* ================================================================
     AÇÕES
     ================================================================ */
  $("newForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var corpo = {
      vendedor: $("fSeller").value.trim(),
      numero_os: $("fOs").value.trim(),
      data_entrega: $("fDate").value,
      observacao: $("fObs").value.trim(),
      loja: perm().verTudo ? $("fStore").value : eu.loja,
    };
    if (!corpo.vendedor) { toast("Informe o vendedor.", true); $("fSeller").focus(); return; }
    if (!corpo.loja) { toast("Selecione a loja.", true); $("fStore").focus(); return; }
    if (!corpo.numero_os) { toast("Informe o número da OS.", true); $("fOs").focus(); return; }
    if (!corpo.data_entrega) { toast("Informe a data de entrega.", true); $("fDate").focus(); return; }

    var btn = $("fSubmit");
    btn.disabled = true;
    api("/os", { method: "POST", body: corpo }).then(function () {
      $("fSeller").value = ""; $("fOs").value = ""; $("fObs").value = "";
      $("fDate").value = hojeISO();
      $("fOs").focus();
      toast("OS " + corpo.numero_os + " lançada para " + corpo.loja + ".");
      return recarregar(true);
    }).catch(falhou).then(function () { btn.disabled = false; });
  });

  $("storeForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var nome = $("sName").value.trim();
    if (!nome) return;
    api("/admin/lojas", { method: "POST", body: { nome: nome } }).then(function () {
      $("sName").value = "";
      toast(nome + " adicionada.");
      return recarregar(true);
    }).catch(falhou);
  });

  $("uRole").addEventListener("change", function () {
    var ehLoja = $("uRole").value === "store";
    $("uStoreField").hidden = !ehLoja;
    if (ehLoja && $("uStore").value) {
      $("uName").value = $("uStore").value;
      $("uLogin").value = apelido($("uStore").value);
    } else if ($("uRole").value === "lab") {
      $("uName").value = "Laboratório";
      $("uLogin").value = "laboratorio";
    } else {
      $("uName").value = ""; $("uLogin").value = "";
    }
  });
  $("uStore").addEventListener("change", function () {
    if ($("uRole").value !== "store") return;
    $("uName").value = $("uStore").value;
    $("uLogin").value = apelido($("uStore").value);
  });

  $("userForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var corpo = {
      perfil: $("uRole").value,
      nome: $("uName").value.trim(),
      login: apelido($("uLogin").value),
      senha: $("uPass").value,
      loja: $("uRole").value === "store" ? $("uStore").value : "",
    };
    var btn = $("uSubmit");
    btn.disabled = true;
    api("/admin/usuarios", { method: "POST", body: corpo }).then(function () {
      $("uPass").value = ""; $("uName").value = ""; $("uLogin").value = "";
      toast("Acesso " + corpo.login + " criado.");
      return carregarUsuarios();
    }).catch(falhou).then(function () { btn.disabled = false; });
  });

  function criarQueFaltam() {
    var faltando = lojas.filter(function (s) {
      return !usuarios.some(function (u) { return u.perfil === "store" && u.loja === s; });
    });
    var plano = faltando.map(function (s) { return { login: apelido(s), nome: s, perfil: "store", loja: s }; });
    if (!usuarios.some(function (u) { return u.perfil === "lab"; }) &&
        !usuarios.some(function (u) { return u.login === "laboratorio"; })) {
      plano.push({ login: "laboratorio", nome: "Laboratório", perfil: "lab", loja: "" });
    }
    plano = plano.filter(function (p) { return p.login && !usuarios.some(function (u) { return u.login === p.login; }); });
    if (!plano.length) { toast("Nada a criar.", true); return; }

    perguntar({
      title: "Criar " + plano.length + (plano.length === 1 ? " acesso" : " acessos") + "?",
      text: plano.map(function (p) { return p.nome + " → login " + p.login; }).join("\n") +
        "\n\nTodos com a mesma senha inicial, com troca obrigatória no primeiro acesso.",
      label: "Senha inicial",
      value: "unico2026",
      confirmLabel: "Criar acessos",
    }).then(function (senha) {
      if (!senha) return;
      if (String(senha).length < 6) { toast("A senha inicial precisa ter no mínimo 6 caracteres.", true); return; }
      toast("Criando " + plano.length + " acessos…");
      return plano.reduce(function (fila, p) {
        return fila.then(function () {
          return api("/admin/usuarios", {
            method: "POST",
            body: { perfil: p.perfil, nome: p.nome, login: p.login, senha: senha, loja: p.loja },
          });
        });
      }, Promise.resolve()).then(function () {
        return carregarUsuarios().then(function () {
          return perguntar({
            title: "Acessos criados",
            text: "Entregue o login e esta senha inicial para cada responsável. No primeiro acesso o sistema pede a troca.",
            code: String(senha),
            confirmLabel: "Entendi",
            onlyOk: true,
          });
        });
      });
    }).catch(falhou);
  }

  function verHistorico(id) {
    api("/os/" + encodeURIComponent(id) + "/historico").then(function (r) {
      var trilha = (r.historico || []).slice().reverse();
      if (!trilha.length) { toast("Esta OS não tem histórico registrado.", true); return; }
      $("modalTitle").textContent = "OS " + r.os.numero_os + " · " + (r.os.loja || "—");
      $("modalText").hidden = true;
      $("modalCode").hidden = true;
      $("modalField").hidden = true;
      $("modalNo").hidden = true;
      $("modalYes").textContent = "Fechar";
      var host = $("modalTrail");
      host.innerHTML = '<div class="trail">' + trilha.map(function (h) {
        var meta = metaEtapa(h.etapa);
        return '<div class="trail-item ' + meta.cls + '"><b>' + esc(meta.label) + "</b><span>" +
          esc(brQuando(h.em) || "—") + (h.por ? " · " + esc(h.por) : "") + "</span></div>";
      }).join("") + "</div>";
      host.hidden = false;
      resolveModal = function () { host.hidden = true; host.innerHTML = ""; };
      $("modal").hidden = false;
      $("modalYes").focus();
    }).catch(falhou);
  }

  document.addEventListener("change", function (ev) {
    var sel = ev.target;
    if (!sel || !sel.dataset || !sel.dataset.pick) return;
    var it = itens.filter(function (x) { return x.id === sel.dataset.pick; })[0];
    if (!it) { toast("Essa OS não está mais disponível.", true); return; }
    if (sel.value === etapaDe(it)) return;
    var destino = sel.value;
    sel.disabled = true;
    api("/os/" + encodeURIComponent(it.id) + "/etapa", { method: "POST", body: { etapa: destino } })
      .then(function () {
        toast("OS " + it.numero_os + " → " + ETAPAS[destino].label + ".");
        return recarregar(true);
      })
      .catch(function (e) { falhou(e); return recarregar(true); })
      .then(function () { sel.disabled = false; });
  });

  document.addEventListener("click", function (ev) {
    var t = ev.target.closest("button");
    if (!t) return;

    if (t.dataset.tab) { aba = t.dataset.tab; desenharTopo(); return; }
    if (t.id === "seedBtn") { criarQueFaltam(); return; }
    if (t.dataset.hist) { verHistorico(t.dataset.hist); return; }
    if (t.dataset.cancel) { editando = null; desenharTudo(); return; }

    /* ---- lojas ---- */
    if (t.dataset.store) {
      var loja = t.dataset.store;
      perguntar({
        title: "Remover " + loja + "?",
        text: "A loja sai da lista de lançamento e dos filtros. Se tiver OS ou login vinculado, ela é mantida no banco como inativa — o histórico não se perde.",
        confirmLabel: "Remover loja",
      }).then(function (sim) {
        if (!sim) return;
        return api("/admin/lojas/" + encodeURIComponent(loja), { method: "DELETE" }).then(function (r) {
          toast(r.inativada ? loja + " inativada. " + r.motivo : loja + " removida.");
          return recarregar(true);
        });
      }).catch(falhou);
      return;
    }

    /* ---- acessos ---- */
    var login = t.dataset.reset || t.dataset.toggle || t.dataset.userdel;
    if (login) {
      var u = usuarios.filter(function (x) { return x.login === login; })[0];
      if (!u) return;
      if (t.dataset.reset) {
        perguntar({
          title: "Nova senha para " + u.nome,
          text: "O usuário entra com esta senha e o sistema pede a troca no primeiro acesso. As sessões abertas dele caem.",
          label: "Senha inicial", value: "", confirmLabel: "Definir senha",
        }).then(function (senha) {
          if (!senha) return;
          return api("/admin/usuarios/" + encodeURIComponent(login) + "/senha", { method: "POST", body: { senha: senha } })
            .then(function () { return carregarUsuarios(); })
            .then(function () {
              return perguntar({ title: "Senha redefinida", text: "Entregue esta senha para " + u.nome + ".", code: String(senha), confirmLabel: "Entendi", onlyOk: true });
            });
        }).catch(falhou);
        return;
      }
      if (t.dataset.toggle) {
        api("/admin/usuarios/" + encodeURIComponent(login) + "/ativo", { method: "POST", body: { ativo: !u.ativo } })
          .then(function () { toast(u.nome + (u.ativo ? " inativado." : " ativado.")); return carregarUsuarios(); })
          .catch(falhou);
        return;
      }
      perguntar({
        title: "Excluir o acesso de " + u.nome + "?",
        text: "O login " + u.login + " deixa de funcionar. As OS lançadas por ele continuam no histórico.",
        confirmLabel: "Excluir acesso",
      }).then(function (sim) {
        if (!sim) return;
        return api("/admin/usuarios/" + encodeURIComponent(login), { method: "DELETE" })
          .then(function () { toast("Acesso de " + u.nome + " excluído."); return carregarUsuarios(); });
      }).catch(falhou);
      return;
    }

    /* ---- OS ---- */
    var id = t.dataset.done || t.dataset.del || t.dataset.edit || t.dataset.save;
    if (!id) return;
    var it = itens.filter(function (x) { return x.id === id; })[0];
    if (!it) { toast("Essa OS não está mais disponível.", true); return; }

    if (t.dataset.done) {
      t.disabled = true;
      api("/os/" + encodeURIComponent(id) + "/etapa", { method: "POST", body: { etapa: "finalizada" } })
        .then(function () { toast("OS " + it.numero_os + " recebida na loja."); return recarregar(true); })
        .catch(function (e) { falhou(e); t.disabled = false; });
      return;
    }
    if (t.dataset.del) {
      perguntar({
        title: "Excluir a OS " + it.numero_os + "?",
        text: "Loja " + (it.loja || "—") + ", vendedor " + (it.vendedor || "—") + ". Essa ação não pode ser desfeita.",
        confirmLabel: "Excluir OS",
      }).then(function (sim) {
        if (!sim) return;
        return api("/os/" + encodeURIComponent(id), { method: "DELETE" })
          .then(function () { toast("OS " + it.numero_os + " excluída."); return recarregar(true); });
      }).catch(falhou);
      return;
    }
    if (t.dataset.edit) { editando = id; desenharTudo(); return; }
    if (t.dataset.save) {
      var caixa = document.querySelector('[data-form="' + id + '"]');
      if (!caixa) return;
      var pega = function (f) {
        var el = caixa.querySelector('[data-f="' + f + '"]');
        return el ? el.value.trim() : "";
      };
      var corpo = {
        vendedor: pega("vendedor"),
        numero_os: pega("numero_os"),
        data_entrega: pega("data_entrega"),
        observacao: pega("observacao"),
      };
      if (perm().verTudo) corpo.loja = pega("loja");
      if (!corpo.vendedor || !corpo.numero_os) { toast("Vendedor e número da OS são obrigatórios.", true); return; }
      t.disabled = true;
      api("/os/" + encodeURIComponent(id), { method: "PATCH", body: corpo })
        .then(function () { editando = null; toast("OS " + corpo.numero_os + " atualizada."); return recarregar(true); })
        .catch(function (e) { falhou(e); t.disabled = false; });
    }
  });

  /* ------------------------------------------------------ relatórios */
  function rodarConsulta() {
    consulta = {
      de: $("qFrom").value,
      ate: $("qTo").value,
      loja: perm().verTudo ? $("qStore").value : "",
      etapa: $("qStatus").value,
      numero: $("qOs").value.trim(),
      vendedor: $("qSeller").value.trim(),
    };
    desenharRelatorio();
  }
  $("qRun").addEventListener("click", rodarConsulta);
  $("qClear").addEventListener("click", function () {
    $("qFrom").value = primeiroDoMes();
    $("qTo").value = hojeISO();
    $("qStore").value = ""; $("qStatus").value = ""; $("qOs").value = ""; $("qSeller").value = "";
    rodarConsulta();
  });
  ["qOs", "qSeller"].forEach(function (id) {
    $(id).addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); rodarConsulta(); } });
  });

  $("expCsv").addEventListener("click", function () {
    if (!consulta) rodarConsulta();
    var p = new URLSearchParams();
    if (consulta.de) p.set("de", consulta.de);
    if (consulta.ate) p.set("ate", consulta.ate);
    if (consulta.loja) p.set("loja", consulta.loja);
    if (consulta.etapa) p.set("etapa", consulta.etapa);
    if (consulta.numero) p.set("numero", consulta.numero);
    if (consulta.vendedor) p.set("vendedor", consulta.vendedor);
    window.location.href = "/api/os/exportar.csv?" + p.toString();
  });
  $("expPrint").addEventListener("click", function () {
    if (!consulta) rodarConsulta();
    setTimeout(function () { window.print(); }, 120);
  });

  /* ================================================================
     PARTIDA
     ================================================================ */
  $("todayLabel").textContent = brData(hojeISO());
  $("fDate").value = hojeISO();
  $("qFrom").value = primeiroDoMes();
  $("qTo").value = hojeISO();

  api("/estado").then(function (r) {
    if (r.precisaInstalar) { mostrarPortao("instalar"); return; }
    if (!r.eu) { mostrarPortao("login"); return; }
    eu = r.eu;
    if (eu.trocarSenha) { mostrarPortao("trocar"); return; }
    return entrarNoSistema();
  }).catch(function () {
    $("gate").hidden = false;
    $("app").hidden = true;
    $("gateTag").textContent = "Sem conexão";
    $("gateTitle").innerHTML = "Servidor <em>indisponível</em>";
    $("gateSub").textContent = "Não foi possível falar com o servidor. Verifique a conexão e recarregue a página.";
    $("gateForm").hidden = true;
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && eu && !editando && !resolveModal) recarregar(true);
  });
})();
