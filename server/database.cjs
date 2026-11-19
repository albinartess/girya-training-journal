'use strict';
const {DatabaseSync} = require('node:sqlite');
const {mkdirSync, readFileSync} = require('node:fs');
const path = require('node:path');
function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), {recursive:true});
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  return db;
}
function transaction(db, fn) {db.exec('BEGIN IMMEDIATE'); try {const result=fn();db.exec('COMMIT');return result} catch(e){db.exec('ROLLBACK');throw e}}
function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT;');
  const version = db.prepare('SELECT MAX(version) v FROM schema_migrations').get().v || 0;
  if (version > 1) throw Error('Database is newer than this server');
  if (version < 1) transaction(db, () => {
    db.exec(readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
    db.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(Date.now());
  });
}
module.exports = {openDatabase,migrate,transaction};
