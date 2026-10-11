import db from '../sql';

/** Error codes that mean "this DB is not writable for the life of
 *  this process": the directory is read-only, the file is on a
 *  read-only mount, permissions are wrong, etc. One occurrence is
 *  enough to decide chat persistence is off for this run; retrying
 *  on every message just floods the log with the same stack. */
const PERSISTENT_SQLITE_FAILURES = new Set(['SQLITE_READONLY', 'SQLITE_CANTOPEN', 'SQLITE_PERM']);

let persistenceDisabled = false;

export async function logChatMessage(username: string, message: string, ipAddress: string | undefined): Promise<void> {
    if (persistenceDisabled) return;
    const timestamp = new Date().getTime();

    return new Promise((resolve, reject) => {
        db.run(
            "INSERT INTO chat_messages (username, message, ip_address, timestamp) VALUES (?, ?, ?, ?)",
            [username, message, ipAddress, timestamp],
            (err: (Error & { code?: string }) | null) => {
                if (!err) { resolve(); return; }
                if (err.code && PERSISTENT_SQLITE_FAILURES.has(err.code) && !persistenceDisabled) {
                    persistenceDisabled = true;
                    console.warn(
                        `[chat-repository] disabling chat-log persistence for this run: ${err.code}. ` +
                        'The chat broadcast path is unaffected; only the audit INSERT is skipped.'
                    );
                    // Treat the first persistent failure as handled
                    // rather than a thrown error so the caller does
                    // not log its own warning on top of ours.
                    resolve();
                    return;
                }
                reject(err);
            }
        );
    });
}

module.exports = { logChatMessage };
