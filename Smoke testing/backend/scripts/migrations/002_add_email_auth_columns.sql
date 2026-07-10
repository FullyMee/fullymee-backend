-- Migration: add email auth compatibility for users and otp_requests

SET @users_email_column_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'email'
);
SET @users_email_column_sql = IF(
  @users_email_column_exists = 0,
  'ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL',
  'SELECT 1'
);
PREPARE users_email_column_stmt FROM @users_email_column_sql;
EXECUTE users_email_column_stmt;
DEALLOCATE PREPARE users_email_column_stmt;

SET @users_email_index_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND INDEX_NAME = 'uniq_users_email'
);
SET @users_email_index_sql = IF(
  @users_email_index_exists = 0,
  'CREATE UNIQUE INDEX uniq_users_email ON users (email)',
  'SELECT 1'
);
PREPARE users_email_index_stmt FROM @users_email_index_sql;
EXECUTE users_email_index_stmt;
DEALLOCATE PREPARE users_email_index_stmt;

SET @otp_email_column_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'otp_requests'
    AND COLUMN_NAME = 'email'
);
SET @otp_email_column_sql = IF(
  @otp_email_column_exists = 0,
  'ALTER TABLE otp_requests ADD COLUMN email VARCHAR(255) NULL',
  'SELECT 1'
);
PREPARE otp_email_column_stmt FROM @otp_email_column_sql;
EXECUTE otp_email_column_stmt;
DEALLOCATE PREPARE otp_email_column_stmt;

SET @otp_email_index_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'otp_requests'
    AND INDEX_NAME = 'uniq_otp_requests_email'
);
SET @otp_email_index_sql = IF(
  @otp_email_index_exists = 0,
  'CREATE UNIQUE INDEX uniq_otp_requests_email ON otp_requests (email)',
  'SELECT 1'
);
PREPARE otp_email_index_stmt FROM @otp_email_index_sql;
EXECUTE otp_email_index_stmt;
DEALLOCATE PREPARE otp_email_index_stmt;
