CREATE DATABASE IF NOT EXISTS hourcontdan CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hourcontdan;
CREATE TABLE IF NOT EXISTS employees (
  id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(100) NOT NULL, email VARCHAR(160) UNIQUE NOT NULL,
  role ENUM('admin','manager','employee') NOT NULL, password_hash VARCHAR(200) NOT NULL
);
CREATE TABLE IF NOT EXISTS attendance (
  id INT PRIMARY KEY AUTO_INCREMENT, employee_id INT NOT NULL,
  started_at DATETIME NOT NULL, ended_at DATETIME NULL,
  open_employee_id INT GENERATED ALWAYS AS (IF(ended_at IS NULL, employee_id, NULL)) STORED,
  UNIQUE KEY unique_open_shift (open_employee_id),
  INDEX attendance_employee_start (employee_id, started_at),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE TABLE IF NOT EXISTS tasks (
  id INT PRIMARY KEY AUTO_INCREMENT, employee_id INT NOT NULL, title VARCHAR(140) NOT NULL,
  status ENUM('pending','doing','done') NOT NULL DEFAULT 'pending',
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INT PRIMARY KEY AUTO_INCREMENT, employee_id INT NOT NULL, message VARCHAR(200) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, read_at DATETIME NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);
