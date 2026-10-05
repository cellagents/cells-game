import db from '../sql';

export async function logFailedLoginAttempt(username: string, ipAddress: string | undefined): Promise<void> {
    return new Promise((resolve) => {
        db.run(
            "INSERT INTO failed_login_attempts (username, ip_address) VALUES (?, ?)",
            [username, ipAddress],
            (err) => {
                if (err) console.error(err);
                resolve();
            }
        );
    });
}

module.exports = { logFailedLoginAttempt };
