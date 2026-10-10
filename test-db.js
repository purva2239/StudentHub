
const pool = require("./database");

async function testConnection() {
    try {
        const connection = await pool.getConnection();

        console.log("[OK] MySQL connected successfully!");

        const [rows] = await connection.query(
            "SELECT COUNT(*) AS total_students FROM student"
        );

        console.log("Database: student_management");
        console.log("Total students:", rows[0].total_students);

        connection.release();
    } catch (error) {
        console.error("[ERROR] Database connection failed.");
        console.error("Error code:", error.code || "UNKNOWN");
        console.error("Check your .env settings and MySQL service.");
    } finally {
        await pool.end();
    }
}

testConnection();