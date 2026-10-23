-- A database as version 1 of the schema wrote it, with one value of each type. This file is a
-- frozen copy: it never changes, and a later version of the schema must open it.
CREATE TABLE variable_types (
    scope TEXT NOT NULL CHECK (scope IN ('bot', 'server', 'member', 'user')),
    name  TEXT NOT NULL,
    type  TEXT NOT NULL CHECK (type IN ('integer', 'decimal', 'text', 'boolean')),
    PRIMARY KEY (scope, name)
) STRICT, WITHOUT ROWID;

CREATE TABLE variables (
    scope TEXT NOT NULL,
    key   TEXT NOT NULL,
    name  TEXT NOT NULL,
    value ANY NOT NULL,
    PRIMARY KEY (scope, key, name),
    FOREIGN KEY (scope, name) REFERENCES variable_types (scope, name)
        ON DELETE CASCADE ON UPDATE CASCADE
) STRICT, WITHOUT ROWID;

INSERT INTO variable_types (scope, name, type) VALUES
    ('bot', 'motto', 'text'),
    ('server', 'visits', 'integer'),
    ('member', 'warnings', 'integer'),
    ('user', 'ratio', 'decimal'),
    ('user', 'vip', 'boolean');

INSERT INTO variables (scope, key, name, value) VALUES
    ('bot', '', 'motto', 'hello'),
    ('server', '100', 'visits', 7),
    ('member', '100:42', 'warnings', 2),
    ('user', '42', 'ratio', 0.5),
    ('user', '42', 'vip', 1);

PRAGMA user_version = 1;
