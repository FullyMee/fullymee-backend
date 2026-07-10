-- Migration: relax legacy phone columns for email OTP auth compatibility

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
SET @otp_phone_relax_sql = IF(
  @otp_phone_col_exists = 1 AND @otp_phone_in_pk = 0,
  'ALTER TABLE otp_requests MODIFY COLUMN phone VARCHAR(255) NULL',
  'SELECT 1'
);
PREPARE otp_phone_relax_stmt FROM @otp_phone_relax_sql;
EXECUTE otp_phone_relax_stmt;
DEALLOCATE PREPARE otp_phone_relax_stmt;

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
SET @users_phone_relax_sql = IF(
  @users_phone_col_exists = 1 AND @users_phone_in_pk = 0,
  'ALTER TABLE users MODIFY COLUMN phone VARCHAR(255) NULL',
  'SELECT 1'
);
PREPARE users_phone_relax_stmt FROM @users_phone_relax_sql;
EXECUTE users_phone_relax_stmt;
DEALLOCATE PREPARE users_phone_relax_stmt;
