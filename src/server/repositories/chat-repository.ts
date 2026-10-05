import db from '../sql';

export async function logChatMessage(username: string, message: string, ipAddress: string | undefined): Promise<void> {
    const timestamp = new Date().getTime();

    return new Promise((resolve, reject) => {
        db.run(
            "INSERT INTO chat_messages (username, message, ip_address, timestamp) VALUES (?, ?, ?, ?)",
            [username, message, ipAddress, timestamp],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

module.exports = { logChatMessage };
