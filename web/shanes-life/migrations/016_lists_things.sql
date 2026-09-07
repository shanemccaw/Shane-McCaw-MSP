-- Shane's Life -- Lists, Things and Who fixed what (Git #3107).
--
-- Design/design_handoff_shanes_life/README.md, "Data model additions":
--   lists(name, created_by ('shane'|'claude'));  list_items(list_id, text, done)
--   things(name, place, house);                  contacts(name, phone, did, house, when)
--
-- On `when`: it is a reserved SQL word, so contacts stores it as `fixed_on`. Screen 11's "Who
-- fixed what" row reads name / what . when / phone, and `did` + `fixed_on` are that "what . when".

CREATE TABLE IF NOT EXISTS lists (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       text        NOT NULL,
    category   text,                                   -- set when Claude made the list on the fly;
                                                       -- what drives the `New category` badge
    icon       text,
    created_by text        NOT NULL DEFAULT 'shane',   -- shane | claude
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lists_user_name_key ON lists (user_id, lower(name)) WHERE archived_at IS NULL;

-- `watch ...` / `read ...` land here, creating the list if it is missing -- so the unique index
-- above is what makes "the list is created if missing" a real upsert rather than a duplicate.
CREATE TABLE IF NOT EXISTS list_items (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id    uuid        NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    text       text        NOT NULL,
    done       boolean     NOT NULL DEFAULT false,
    done_at    timestamptz,
    note       text,
    position   integer     NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS list_items_list_idx ON list_items (list_id, done, position, created_at);

-- "where's the drill?" answers out of here. `X is in the garage` requires a place word, which is
-- why place is NOT NULL: a things row with no place answers nothing.
CREATE TABLE IF NOT EXISTS things (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       text        NOT NULL,
    place      text        NOT NULL,
    house      text,                                   -- H1 / H2 / the rental -- the hub in hub/spoke
    note       text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS things_user_name_idx ON things (user_id, lower(name));
CREATE INDEX IF NOT EXISTS things_house_idx     ON things (user_id, house);

-- `plumber is Ray 321-555-0142` -> "Who fixed what".
CREATE TABLE IF NOT EXISTS contacts (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       text        NOT NULL,
    phone      text,
    did        text,                                   -- what they actually fixed
    house      text,
    fixed_on   date,                                   -- design: `when`
    trade      text,                                   -- plumber / electrician / ...
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contacts_user_idx  ON contacts (user_id, lower(name));
CREATE INDEX IF NOT EXISTS contacts_trade_idx ON contacts (user_id, lower(trade)) WHERE trade IS NOT NULL;
