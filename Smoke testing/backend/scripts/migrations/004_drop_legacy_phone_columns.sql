-- Migration: remove legacy phone columns to enforce email-only authentication

SET @otp_phone_col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'otp_requests'
    AND COLUMN_NAME = 'phone'
);
SET @otp_phone_in_pk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'otp_requests'
    AND COLUMN_NAME = 'phone'
    AND CONSTRAINT_NAME = 'PRIMARY'
);
SET @otp_email_col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'otp_requests'
    AND COLUMN_NAME = 'email'
);
SET @otp_email_pk_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'otp_requests'
    AND COLUMN_NAME = 'email'
    AND CONSTRAINT_NAME = 'PRIMARY'
);

SET @otp_cleanup_sql = IF(
  @otp_email_col_exists = 1,
  'DELETE FROM otp_requests WHERE email IS NULL OR email = ''''',
  'SELECT 1'
);
PREPARE otp_cleanup_stmt FROM @otp_cleanup_sql;
EXECUTE otp_cleanup_stmt;
DEALLOCATE PREPARE otp_cleanup_stmt;

SET @otp_prepare_email_pk_sql = IF(
  @otp_phone_col_exists = 1 AND @otp_phone_in_pk = 1 AND @otp_email_col_exists = 1,
  'ALTER TABLE otp_requests MODIFY COLUMN email VARCHAR(255) NOT NULL',
  'SELECT 1'
);
PREPARE otp_prepare_email_pk_stmt FROM @otp_prepare_email_pk_sql;
EXECUTE otp_prepare_email_pk_stmt;
DEALLOCATE PREPARE otp_prepare_email_pk_stmt;

SET @otp_switch_pk_sql = IF(
  @otp_phone_col_exists = 1 AND @otp_phone_in_pk = 1 AND @otp_email_col_exists = 1 AND @otp_email_pk_exists = 0,
  'ALTER TABLE otp_requests DROP PRIMARY KEY, ADD PRIMARY KEY (email)',
  'SELECT 1'
);
PREPARE otp_switch_pk_stmt FROM @otp_switch_pk_sql;
EXECUTE otp_switch_pk_stmt;
DEALLOCATE PREPARE otp_switch_pk_stmt;

SET @otp_phone_drop_sql = IF(
  @otp_phone_col_exists = 1,
  'ALTER TABLE otp_requests DROP COLUMN phone',
  'SELECT 1'
);
PREPARE otp_phone_drop_stmt FROM @otp_phone_drop_sql;
EXECUTE otp_phone_drop_stmt;
DEALLOCATE PREPARE otp_phone_drop_stmt;

SET @users_phone_col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'phone'
);
SET @users_phone_in_pk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'phone'
    AND CONSTRAINT_NAME = 'PRIMARY'
);
SET @users_email_col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'email'
);
SET @users_email_pk_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'email'
    AND CONSTRAINT_NAME = 'PRIMARY'
);

SET @users_fill_email_sql = IF(
  @users_email_col_exists = 1,
  'UPDATE users SET email = CONCAT(''legacy_'', REPLACE(UUID(), ''-'', ''''), ''@local.invalid'') WHERE email IS NULL OR email = ''''',
  'SELECT 1'
);
PREPARE users_fill_email_stmt FROM @users_fill_email_sql;
EXECUTE users_fill_email_stmt;
DEALLOCATE PREPARE users_fill_email_stmt;

SET @users_prepare_email_pk_sql = IF(
  @users_phone_col_exists = 1 AND @users_phone_in_pk = 1 AND @users_email_col_exists = 1,
  'ALTER TABLE users MODIFY COLUMN email VARCHAR(255) NOT NULL',
  'SELECT 1'
);
PREPARE users_prepare_email_pk_stmt FROM @users_prepare_email_pk_sql;
EXECUTE users_prepare_email_pk_stmt;
DEALLOCATE PREPARE users_prepare_email_pk_stmt;

SET @users_switch_pk_sql = IF(
  @users_phone_col_exists = 1 AND @users_phone_in_pk = 1 AND @users_email_col_exists = 1 AND @users_email_pk_exists = 0,
  'ALTER TABLE users DROP PRIMARY KEY, ADD PRIMARY KEY (email)',
  'SELECT 1'
);
PREPARE users_switch_pk_stmt FROM @users_switch_pk_sql;
EXECUTE users_switch_pk_stmt;
DEALLOCATE PREPARE users_switch_pk_stmt;

SET @users_phone_drop_sql = IF(
  @users_phone_col_exists = 1,
  'ALTER TABLE users DROP COLUMN phone',
  'SELECT 1'
);
PREPARE users_phone_drop_stmt FROM @users_phone_drop_sql;
EXECUTE users_phone_drop_stmt;
DEALLOCATE PREPARE users_phone_drop_stmt;
