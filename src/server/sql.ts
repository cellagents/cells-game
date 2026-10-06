import sqlite3Module from 'sqlite3';
import path from 'path';
import fs from 'fs';
import config from '../config';

const sqlite3 = sqlite3Module.verbose();
const dbPath = path.join(__dirname, 'db', config.server.dbFileName);

const dbFolder = path.dirname(dbPath);
if (!fs.existsSync(dbFolder)) {
    fs.mkdirSync(dbFolder, { recursive: true });
    console.log(`Created the database folder: ${dbFolder}`);
}

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error(err);
    } else {
        console.log('Connected to the SQLite database.');

        db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
            username TEXT,
            message TEXT,
            ip_address TEXT,
            timestamp INTEGER
        )`, (err) => {
            if (err) console.error(err);
            else console.log("Created chat_messages table");
        });
    }
});

process.on('beforeExit', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing the database connection. ', err);
        } else {
            console.log('Closed the database connection.');
        }
    });
});

export default db;
module.exports = db;
