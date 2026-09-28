-- The integration suite's database, separate from the development one so a
-- test run never touches data someone is looking at.
CREATE DATABASE IF NOT EXISTS gradfolio_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON gradfolio_test.* TO 'gradfolio'@'%';
