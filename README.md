# Controle de Montagens — Óticas Único

Sistema de lançamento e acompanhamento de OS de montagem, com login por
loja, perfil de laboratório e administração.

Aplicação **Node.js + Express** com banco **MySQL/MariaDB**. Roda em
qualquer VPS, container ou serviço com Node 18 ou superior. Sem
dependência de plataforma externa: nem CDN, nem serviço de imagem, nem
API de terceiros. O logo é um arquivo local.

---

## 1. Requisitos

| | Versão mínima |
|---|---|
| Node.js | 18 (testado no 22) |
| MySQL | 8.0 — ou MariaDB 10.6 |

---

## 2. Instalação no Coolify (1-Click / Docker Compose)

Esta aplicação é 100% pronta para ser instalada no **Coolify**.

### Opção A: Docker Compose (Aplicação + Banco inclusos)
1. No Coolify, adicione uma nova aplicação escolhendo **Docker Compose**.
2. Aponte para este repositório (`unico-montagem`).
3. O `docker-compose.yml` subirá o servidor Node.js + MariaDB 11 e configurará tudo sozinho.
4. O banco de dados e as tabelas serão auto-inicializados na primeira subida!

### Opção B: Dockerfile / Nixpacks + Banco separado no Coolify
1. Crie um recurso de banco de dados **MariaDB** no Coolify.
2. Adicione a aplicação apontando para o repositório (`Dockerfile` ou `Nixpacks`).
3. Configure as variáveis no Coolify:
   - `DB_HOST`: host do seu banco MariaDB
   - `DB_PORT`: `3306`
   - `DB_USER`: usuário do banco
   - `DB_PASSWORD`: senha do banco
   - `DB_NAME`: `oticas_montagens`
   - `SESSION_SECRET`: uma chave de 64 caracteres gerada para as sessões

---

## 3. Instalação Manual (VPS / Servidor Próprio)

```bash
# 1. código e dependências
cd /var/www/montagens
npm install --omit=dev

# 2. banco de dados: cria o esquema e importa lojas e acessos
mysql -u root -p --default-character-set=utf8mb4 < schema.sql

# 3. um usuário de banco só para a aplicação (não use root)
mysql -u root -p -e "
  CREATE USER 'oticas'@'localhost' IDENTIFIED BY 'ESCOLHA_UMA_SENHA_FORTE';
  GRANT SELECT, INSERT, UPDATE, DELETE ON oticas_montagens.* TO 'oticas'@'localhost';
  FLUSH PRIVILEGES;"

# 4. configuração
cp .env.example .env
nano .env          # preencha DB_PASSWORD e gere o SESSION_SECRET

# 5. sobe
npm start
```

Gere o `SESSION_SECRET` com:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> Esse segredo assina os cookies de sessão. Se ele mudar, todas as
> sessões abertas caem e cada um entra de novo — nada além disso.
> Nunca o versione junto com o código.

### Manter no ar (systemd)

`/etc/systemd/system/montagens.service`

```ini
[Unit]
Description=Controle de Montagens - Oticas Unico
After=network.target mysql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/montagens
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
EnvironmentFile=/var/www/montagens/.env

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now montagens
systemctl status montagens
journalctl -u montagens -f      # acompanha o log
```

### Nginx + HTTPS

O Node escuta em `127.0.0.1:3000`; quem fala com a internet é o Nginx.

```nginx
server {
    server_name montagens.oticasunico.com.br;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # necessário p/ o cookie
    }
}
```

```bash
certbot --nginx -d montagens.oticasunico.com.br
```

**Detalhe que costuma travar o login:** o cookie de sessão é `Secure`
quando `COOKIE_SECURE=true`, e navegador nenhum aceita cookie `Secure`
em HTTP. Enquanto o certificado não estiver de pé, use
`COOKIE_SECURE=false`; depois do HTTPS, volte para `true`. O
`X-Forwarded-Proto` acima é o que faz o Node reconhecer o HTTPS
repassado pelo proxy.

---

## 3. Primeiro acesso

O `schema.sql` já traz os **14 acessos e as 11 lojas** em uso, com as
senhas atuais preservadas — cada um entra com a mesma senha de antes.

Se você preferir começar do zero, apague os usuários
(`DELETE FROM usuarios;`) e abra o site: a primeira tela pede a senha
do administrador (login `fred`). Depois, na aba **Acessos**, o botão
"Criar acessos que faltam" gera os logins de todas as lojas e do
laboratório de uma vez, com senha inicial única e troca obrigatória no
primeiro acesso.

---

## 4. Como está organizado

```
server/
  index.js         sobe o Express, sessão, login, rotas gerais
  db.js            pool de conexões MySQL
  auth.js          PBKDF2, cookie assinado, tabela de sessões
  permissoes.js    ⭐ regras de perfil — fonte única da verdade
  rotas/os.js      lançar, alterar, mudar etapa, excluir, exportar
  rotas/admin.js   lojas e acessos (só administrador)
public/
  index.html       marcação
  estilo.css       identidade visual
  app.js           interface, consome a API
  logo.png         logo tratado, cantos transparentes
schema.sql         esquema + lojas e acessos atuais
dados-atuais.json  o mesmo conteúdo em JSON, para conferência
```

Para mudar qualquer regra de quem pode o quê, o arquivo é
`server/permissoes.js`. A interface só desenha o que o servidor
autoriza: ela lê as permissões em `/api/inicio` e esconde o resto.
Mas quem decide é sempre o servidor — nenhuma rota confia no que o
navegador manda.

### Endpoints

| Método | Rota | O que faz |
|---|---|---|
| GET | `/api/estado` | aberto; diz se precisa instalar e quem está logado |
| POST | `/api/instalar` | cria o administrador (só se não existir nenhum) |
| POST | `/api/login` | abre sessão |
| POST | `/api/logout` | fecha sessão |
| GET | `/api/inicio` | permissões, lojas e OS já recortadas pelo perfil |
| POST | `/api/senha` | troca a própria senha (pede a atual) |
| POST | `/api/primeira-senha` | troca obrigatória no primeiro acesso |
| GET | `/api/os` | lista/filtra |
| POST | `/api/os` | lança |
| PATCH | `/api/os/:id` | altera campos |
| POST | `/api/os/:id/etapa` | muda a etapa e grava o histórico |
| DELETE | `/api/os/:id` | exclui (só administrador) |
| GET | `/api/os/:id/historico` | trilha da OS |
| GET | `/api/os/exportar.csv` | Excel do filtro atual |
| GET/POST/DELETE | `/api/admin/...` | lojas e acessos |

---

## 5. As regras do negócio

### Etapas

`Aguardando` → `Em montagem` → `Coloração` → `Montagem finalizada` → `Recebido na loja`

As quatro primeiras são do laboratório, que transita livremente entre
elas. A última é a loja confirmando que o óculos chegou. Cada mudança
grava data, hora e autor em `os_historico` — é a trilha que a loja
consulta no link "histórico".

### Perfis

|  | Loja | Laboratório | Fred |
|---|---|---|---|
| Vê | só as OS da própria loja | todas as lojas | todas as lojas |
| Lança OS | sim, loja travada no login | não | sim, qualquer loja |
| Muda a etapa | não | as 4 do laboratório | qualquer uma |
| Recebido na loja | sim | não | sim |
| Alterar OS | sim, enquanto não recebida | não | sempre |
| Excluir OS | **não** | não | sim |
| Lojas e acessos | não | não | sim |

Duas regras que o servidor impõe e vale conhecer antes de mexer:

- A loja **não escolhe** a loja no lançamento. Mesmo que o navegador
  mande outra, o servidor grava a loja do login dela.
- A loja **não exclui** OS depois de lançada, só altera. E não altera
  mais depois de recebida.

### Remoção de loja

Loja com OS ou login vinculado não é apagada: fica `ativa = 0`. Sai da
lista de lançamento e dos filtros, mas o histórico continua inteiro e
as chaves estrangeiras seguem válidas.

---

## 6. Segurança

- Senha guardada como **PBKDF2-SHA256, 150.000 rodadas, sal por
  usuário**. Irreversível.
- Sessão em tabela própria. Apagar a linha em `sessoes` derruba o
  acesso na hora. Redefinir a senha de alguém já derruba as sessões
  dele automaticamente.
- Cookie `httpOnly` + `Secure` + assinado por HMAC.
- Toda consulta usa **prepared statement** — sem concatenação de SQL.
- O servidor não diz se um login existe: senha errada e usuário
  inexistente devolvem a mesma mensagem.
- Todas as regras de permissão são checadas no servidor, em cada
  requisição.

O que **ainda não tem** e vale considerar conforme o uso crescer:
limite de tentativas de login por IP, registro de auditoria de
administração, e backup automático do banco (veja abaixo).

---

## 7. Backup

```bash
# diário, às 2h, guardando 30 dias
0 2 * * * mysqldump -u oticas -pSENHA --single-transaction oticas_montagens \
  | gzip > /var/backups/montagens-$(date +\%F).sql.gz
0 3 * * * find /var/backups -name 'montagens-*.sql.gz' -mtime +30 -delete
```

Restaurar:

```bash
gunzip < /var/backups/montagens-2026-09-04.sql.gz | mysql -u root -p oticas_montagens
```

---

## 8. Diagnóstico rápido

| Sintoma | Onde olhar |
|---|---|
| Login aceita a senha e volta para a tela de acesso | cookie descartado. Em HTTP, ponha `COOKIE_SECURE=false`; em HTTPS, confirme o `X-Forwarded-Proto` no Nginx |
| "Não foi possível conectar ao banco de dados" ao subir | `DB_*` no `.env`, e se o usuário do banco tem permissão |
| Acentos saindo errados | banco, tabela e conexão precisam ser `utf8mb4` |
| Erro 500 em alguma tela | `journalctl -u montagens -n 50` |
| Horário das etapas deslocado | fuso do servidor: `timedatectl set-timezone America/Sao_Paulo` |
