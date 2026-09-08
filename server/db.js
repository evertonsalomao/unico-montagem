"use strict";

const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const dbHost = process.env.DB_HOST || "127.0.0.1";
const dbPort = Number(process.env.DB_PORT || 3306);
const dbUser = process.env.DB_USER || "root";
const dbPassword = process.env.DB_PASSWORD || "";
const dbName = process.env.DB_NAME || "oticas_montagens";

const pool = mysql.createPool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPassword,
  database: dbName,
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10,
  timezone: "local",
  dateStrings: true,
  multipleStatements: true,
});

async function q(sql, params) {
  const [rows] = await pool.execute(sql, params === undefined ? [] : params);
  return rows;
}

async function um(sql, params) {
  const rows = await q(sql, params);
  return rows[0] || null;
}

async function transacao(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const saida = await fn(conn);
    await conn.commit();
    return saida;
  } catch (erro) {
    await conn.rollback();
    throw erro;
  } finally {
    conn.release();
  }
}

async function garantirBancoECriarEsquema() {
  try {
    try {
      await pool.query("SELECT 1 AS ok");
    } catch (e) {
      if (e.code === "ER_BAD_DB_ERROR") {
        console.log(`--> Banco de dados '${dbName}' não existe. Criando banco...`);
        const tempConn = await mysql.createConnection({
          host: dbHost,
          port: dbPort,
          user: dbUser,
          password: dbPassword,
          multipleStatements: true,
        });
        await tempConn.query(
          `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
        );
        await tempConn.end();
      } else {
        throw e;
      }
    }

    const [rows] = await pool.query(
      "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'usuarios'"
    );

    if (!rows || !rows[0] || Number(rows[0].total) === 0) {
      console.log("--> Tabela 'usuarios' não encontrada. Aplicando schema.sql...");
      const schemaPath = path.join(__dirname, "..", "schema.sql");
      if (fs.existsSync(schemaPath)) {
        const sqlContent = fs.readFileSync(schemaPath, "utf8");
        await pool.query(sqlContent);
        console.log("--> Banco de dados e tabelas criados com sucesso a partir de schema.sql!");
      }
    }
  } catch (err) {
    console.error("--> Aviso na inicialização do banco:", err.message);
  }
}

async function verificar() {
  await garantirBancoECriarEsquema();
  const r = await um("SELECT COUNT(*) AS total FROM usuarios WHERE perfil = 'admin'");
  return Number(r ? r.total : 0);
}

module.exports = { pool, q, um, transacao, verificar };

