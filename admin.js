const readline = require("node:readline");
const pool = require("./database");
const bcrypt = require("bcryptjs");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question) {
    return new Promise(resolve => {
        rl.question(question, answer => resolve(answer.trim()));
    });
}

async function main() {
    try {
        console.log("\n=== Create Administrator Account ===\n");

        const username = await ask("Enter admin username: ");

        if (!/^[a-zA-Z0-9_.-]{3,50}$/.test(username)) {
            console.log("Username must be 3–50 characters and contain only letters, numbers, _, . or -.");
            return;
        }

        const password = await ask(
            "Enter admin password (minimum 12 characters): "
        );

        if (password.length < 12) {
            console.log("Password must contain at least 12 characters.");
            return;
        }

        const confirmPassword = await ask("Confirm admin password: ");

        if (password !== confirmPassword) {
            console.log("Passwords do not match.");
            return;
        }

        const passwordHash = await bcrypt.hash(password, 12);

        await pool.execute(
            "INSERT INTO admin_users (username, password_hash) VALUES (?, ?)",
            [username, passwordHash]
        );

        console.log("\n[SUCCESS] Administrator account created.");
        console.log("Username:", username);
        console.log("Password stored as a hash, not plain text.");

    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            console.log("That username already exists. Choose another username.");
        } else {
            console.error("Could not create administrator account.");
            console.error("Error code:", error.code || "UNKNOWN");
        }
    } finally {
        rl.close();
        await pool.end();
    }
}

main();