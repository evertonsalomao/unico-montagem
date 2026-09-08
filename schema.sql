-- =====================================================================
--  Controle de Montagens — Óticas Único
--  Esquema do banco + dados atuais (exportados em 04/09/2026)
--
--  Uso:
--    mysql -u root -p --default-character-set=utf8mb4 < schema.sql
--
--  As senhas vêm como hash PBKDF2-SHA256, 150.000 rodadas, sal por
--  usuário. NÃO são reversíveis e continuam valendo: quem já usa o
--  sistema entra com a MESMA senha depois da migração.
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS oticas_montagens
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE oticas_montagens;

DROP TABLE IF EXISTS os_historico;
DROP TABLE IF EXISTS os;
DROP TABLE IF EXISTS sessoes;
DROP TABLE IF EXISTS usuarios;
DROP TABLE IF EXISTS lojas;

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------- lojas
CREATE TABLE lojas (
  nome   VARCHAR(80)  NOT NULL PRIMARY KEY,
  ativa  TINYINT(1)   NOT NULL DEFAULT 1,
  ordem  INT          NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------- usuarios
-- perfil: 'admin' acesso total | 'lab' laboratório | 'store' loja
CREATE TABLE usuarios (
  login         VARCHAR(40)  NOT NULL PRIMARY KEY,
  nome          VARCHAR(80)  NOT NULL,
  perfil        ENUM('admin','lab','store') NOT NULL,
  loja          VARCHAR(80)  NULL,
  senha_hash    CHAR(64)     NOT NULL,
  senha_sal     CHAR(32)     NOT NULL,
  senha_iter    INT          NOT NULL DEFAULT 150000,
  ativo         TINYINT(1)   NOT NULL DEFAULT 1,
  trocar_senha  TINYINT(1)   NOT NULL DEFAULT 1,
  criado_em     DATETIME     NULL,
  ultimo_acesso DATETIME     NULL,
  CONSTRAINT fk_usuario_loja FOREIGN KEY (loja)
    REFERENCES lojas(nome) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------- os
-- etapa: aguardando -> montagem -> coloracao -> montada -> finalizada
--   as quatro primeiras são do laboratório
--   'finalizada' = Recebido na loja, confirmado pela loja
CREATE TABLE os (
  id           VARCHAR(40)  NOT NULL PRIMARY KEY,
  numero_os    VARCHAR(40)  NOT NULL,
  vendedor     VARCHAR(120) NOT NULL,
  loja         VARCHAR(80)  NOT NULL,
  observacao   VARCHAR(500) NULL,
  data_entrega DATE         NOT NULL,
  etapa        ENUM('aguardando','montagem','coloracao','montada','finalizada')
                 NOT NULL DEFAULT 'aguardando',
  criado_em    DATETIME     NOT NULL,
  criado_por   VARCHAR(80)  NULL,
  etapa_em     DATETIME     NULL,
  etapa_por    VARCHAR(80)  NULL,
  montada_em   DATETIME     NULL,
  montada_por  VARCHAR(80)  NULL,
  recebida_em  DATETIME     NULL,
  recebida_por VARCHAR(80)  NULL,
  INDEX idx_os_loja (loja),
  INDEX idx_os_entrega (data_entrega),
  INDEX idx_os_etapa (etapa),
  INDEX idx_os_numero (numero_os),
  CONSTRAINT fk_os_loja FOREIGN KEY (loja)
    REFERENCES lojas(nome) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------- os_historico
-- Uma linha por mudança de etapa. É o histórico que a loja consulta.
CREATE TABLE os_historico (
  id    BIGINT AUTO_INCREMENT PRIMARY KEY,
  os_id VARCHAR(40) NOT NULL,
  etapa VARCHAR(20) NOT NULL,
  em    DATETIME    NOT NULL,
  por   VARCHAR(80) NULL,
  INDEX idx_hist_os (os_id),
  CONSTRAINT fk_hist_os FOREIGN KEY (os_id)
    REFERENCES os(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------- sessoes
-- Sessões ativas. Apagar uma linha aqui derruba o acesso na hora.
CREATE TABLE sessoes (
  id         CHAR(64)    NOT NULL PRIMARY KEY,
  login      VARCHAR(40) NOT NULL,
  criada_em  DATETIME    NOT NULL,
  expira_em  DATETIME    NOT NULL,
  INDEX idx_sessao_login (login),
  INDEX idx_sessao_expira (expira_em),
  CONSTRAINT fk_sessao_usuario FOREIGN KEY (login)
    REFERENCES usuarios(login) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================ dados atuais ============================

-- lojas ativas
INSERT INTO lojas (nome, ativa, ordem) VALUES ('Cianê', 1, 0);
INSERT INTO lojas (nome, ativa, ordem) VALUES ('Votorantim', 1, 1);
INSERT INTO lojas (nome, ativa, ordem) VALUES ('Coop', 1, 2);
INSERT INTO lojas (nome, ativa, ordem) VALUES ('Campolim', 1, 3);
INSERT INTO lojas (nome, ativa, ordem) VALUES ('Wanel Ville', 1, 4);
INSERT INTO lojas (nome, ativa, ordem) VALUES ('Itavuvu', 1, 5);
INSERT INTO lojas (nome, ativa, ordem) VALUES ('Braguinha', 1, 6);
INSERT INTO lojas (nome, ativa, ordem) VALUES ('Araçoiaba da Serra', 1, 7);
INSERT INTO lojas (nome, ativa, ordem) VALUES ('Esplanada', 1, 8);
INSERT INTO lojas (nome, ativa, ordem) VALUES ('Boa', 1, 9);

-- loja fora da operação, mantida porque ainda tem login vinculado
INSERT INTO lojas (nome, ativa, ordem) VALUES ('Precisão', 0, 99);

-- acessos (senhas preservadas)
INSERT INTO usuarios (login, nome, perfil, loja, senha_hash, senha_sal, senha_iter, ativo, trocar_senha, criado_em, ultimo_acesso)
  VALUES ('fred', 'Fred', 'admin', NULL, '499181f37b83e8aa0a7c25e7243cf511c87b99281dfe3168892f1c63a428df3b', '0a98fdce7b80e27c81887a821ef3b277', 150000, 1, 0, '2026-09-04 16:29:54', '2026-09-04 18:03:34');
INSERT INTO usuarios (login, nome, perfil, loja, senha_hash, senha_sal, senha_iter, ativo, trocar_senha, criado_em, ultimo_acesso)
  VALUES ('diego', 'Diego', 'lab', NULL, 'b9cf99b050ed3aac6173fb4d91cae59f7a9682bccca65fe71d49877817d222a1', '6bbf987e116ec7c454cffdd3c5ed2714', 150000, 1, 0, '2026-09-04 17:37:14', '2026-09-04 17:52:04');
INSERT INTO usuarios (login, nome, perfil, loja, senha_hash, senha_sal, senha_iter, ativo, trocar_senha, criado_em, ultimo_acesso)
  VALUES ('laboratorio', 'Keyla', 'lab', NULL, 'b8adeafb73c44b319f0ea65becc0f01c67fd1224fab9c0d102db64487da63234', 'f8cf86ca250e0f812c39763434d95054', 150000, 1, 0, '2026-09-04 16:33:48', '2026-09-04 17:57:13');
INSERT INTO usuarios (login, nome, perfil, loja, senha_hash, senha_sal, senha_iter, ativo, trocar_senha, criado_em, ultimo_acesso)
  VALUES ('aracoiaba-da-serra', 'Araçoiaba da Serra', 'store', 'Araçoiaba da Serra', '68db77b76df132f0e7e401b7fde453d25adaa98d5bef3ecfdfed90b4b525d137', 'cbe2e8e273d5e86ca6dd528e2eaacc38', 150000, 1, 1, '2026-09-04 16:33:05', NULL);
INSERT INTO usuarios (login, nome, perfil, loja, senha_hash, senha_sal, senha_iter, ativo, trocar_senha, criado_em, ultimo_acesso)
  VALUES ('boa', 'Boa', 'store', 'Boa', '622239d0ea73b490e0a2604be4705d451549ec8337bfc8301e10a5213d315f7f', '935972041e8a91129fd1daa6cda90226', 150000, 1, 1, '2026-09-04 16:33:17', NULL);
INSERT INTO usuarios (login, nome, perfil, loja, senha_hash, senha_sal, senha_iter, ativo, trocar_senha, criado_em, ultimo_acesso)
  VALUES ('braguinha', 'Braguinha', 'store', 'Braguinha', '991c125c1b866bf391db6d4874c6d7b77ff6037ea880bb677c263d6d3f5c0886', '49675796d3ba8993bbc297afb0863373', 150000, 1, 1, '2026-09-04 16:32:59', NULL);
INSERT INTO usuarios (login, nome, perfil, loja, senha_hash, senha_sal, senha_iter, ativo, trocar_senha, criado_em, ultimo_acesso)
  VALUES ('campolim', 'Campolim', 'store', 'Campolim', 'caffd1ee5489bcbcd4b0eb856aa741cec46b3a5ae73d14733d961c49535d2823', '2df5585e9037eccb5941d30797b65c42', 150000, 1, 1, '2026-09-04 16:32:41', NULL);
INSERT INTO usuarios (login, nome, perfil, loja, senha_hash, senha_sal, senha_iter, ativo, trocar_senha, criado_em, ultimo_acesso)
  VALUES ('ciane', 'Cianê', 'store', 'Cianê', '887b9db922bb61a7d23aeac57ddbe13cc37f8a5253be9f625ff7016f72cd9598', 'd103b758205a156e516719aa15690904', 150000, 1, 0, '2026-09-04 16:32:18', '2026-09-04 17:58:54');
INSERT INTO usuarios (login, nome, perfil, loja, senha_hash, senha_sal, senha_iter, ativo, trocar_senha, criado_em, ultimo_acesso)
  VALUES ('coop', 'Coop', 'store', 'Coop', 'ec96f9cdc13898070699e67ebd386ac1210f405b96c0fe554985c29b7adabeae', '835fa81bf7f3682c7318ae2832342234', 150000, 1, 1, '2026-09-04 16:32:33', NULL);
INSERT INTO usuarios (login, nome, perfil, loja, senha_hash, senha_sal, senha_iter, ativo, trocar_senha, criado_em, ultimo_acesso)
  VALUES ('esplanada', 'Esplanada', 'store', 'Esplanada', '0eda5a91eed4f1c6248be1d170b436a428c69ad11d92b405a05f662b8bc37e44', '5bc194dbd8054273cffdcd2d4ac7abc0', 150000, 1, 1, '2026-09-04 16:33:10', NULL);
INSERT INTO usuarios (login, nome, perfil, loja, senha_hash, senha_sal, senha_iter, ativo, trocar_senha, criado_em, ultimo_acesso)
  VALUES ('itavuvu', 'Itavuvu', 'store', 'Itavuvu', 'b38d13d3287726e86104eb4350576a7b18e9ca52848802e1cba3e18be4472f01', '49c7eb00ded67b8e48858a211b59f4a1', 150000, 1, 1, '2026-09-04 16:32:53', NULL);
INSERT INTO usuarios (login, nome, perfil, loja, senha_hash, senha_sal, senha_iter, ativo, trocar_senha, criado_em, ultimo_acesso)
  VALUES ('precisao', 'Precisão', 'store', 'Precisão', '0c3c03013c3f4ffcdeb20876126611b5a08c2dae0c0b3f14612be8530e586886', '7ce7811dd145d23d47a71a0db876e7e9', 150000, 0, 1, '2026-09-04 16:33:59', NULL);
INSERT INTO usuarios (login, nome, perfil, loja, senha_hash, senha_sal, senha_iter, ativo, trocar_senha, criado_em, ultimo_acesso)
  VALUES ('votorantim', 'Votorantim', 'store', 'Votorantim', 'f69807fb6aa6ed000f4123cfdbbad51a6cc28b09200c04f409d700af79b40fcb', '5b8e4dfef9435383526186bdfbd616a9', 150000, 1, 1, '2026-09-04 16:32:27', NULL);
INSERT INTO usuarios (login, nome, perfil, loja, senha_hash, senha_sal, senha_iter, ativo, trocar_senha, criado_em, ultimo_acesso)
  VALUES ('wanel-ville', 'Wanel Ville', 'store', 'Wanel Ville', '496d95626b41c74279a64d98fff742102cd6d648ab51350359ec32bbd6ab9ef3', '03c3f944ff58d43d9799afce6c6a478f', 150000, 1, 1, '2026-09-04 16:32:47', NULL);

-- OS: zeradas em 04/09/2026 a pedido. O sistema começa limpo.

