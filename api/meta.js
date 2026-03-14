import { pool } from './_db.js';

const DEFAULT_MEMBERS = [
  'Maximilian Leclerc',
  'Pietro "Devil" D\'Lenfer',
  'Bjorn "Thor" D\'Lenfer',
  'Jazmin "Jazz" Reis',
  'Wolfgang "Kaiser" Larsen',
  'Lucas Vance',
  'Apollo "Lobo" Castillo',
  'Siegfried "Tekken" Larsen',
  'Ricardo Lionhearth',
  'Chuck Silver',
  'Dante D\'Lenfer',
  'Tristan D\'Lenfer',
  'Angelique "Angel" Melbourne',
  'Kaleb Chester',
  'Søren "Caju" D\'Ulven',
  'Matteo "Tet" Brown',
  'Baltazar "Bills" D\'Lenfer'
];

const DEFAULT_PROSPECTS = [
  'Aurora "Castillo" Castillo',
  'Jorsh Garcia',
  'Rebecca "Belladonna" Celestine',
  'Amanda "Valquíria" Winters',
  'Amora Corvus',
  'Carraig "Corvo" Dubhghaill',
  'Jesse "Foster" Foster'
];

const REMOVED_NAMES = ['Isaiah D\'Lenfer'];
const VALID_PERSON_TYPES = new Set(['membro', 'prospect']);
const VALID_STATUS = new Set(['pago', 'pendente', 'justificado']);

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeName(value) {
  return cleanName(value).toLocaleLowerCase('pt-BR');
}

function sortNames(list) {
  return [...list].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
}

function startOfWeekString(referenceDate = new Date()) {
  const d = new Date(referenceDate);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

async function ensureMetaSchema(client) {
  await client.query(`
    create table if not exists weekly_goals (
      id bigserial primary key,
      week_number integer not null unique,
      week_start date not null,
      created_at timestamptz not null default now()
    )
  `);

  await client.query(`
    create table if not exists weekly_goal_entries (
      id bigserial primary key,
      weekly_goal_id bigint not null references weekly_goals(id) on delete cascade,
      person_name text not null,
      person_type text not null check (person_type in ('membro', 'prospect')),
      amount numeric not null default 0,
      status text not null default 'pendente' check (status in ('pago', 'pendente', 'justificado')),
      justification text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (weekly_goal_id, person_name, person_type)
    )
  `);

  await client.query(`
    create table if not exists meta_people (
      id bigserial primary key,
      person_name text not null unique,
      person_type text not null check (person_type in ('membro', 'prospect')),
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);


  await client.query(`
    alter table weekly_goal_entries
    add column if not exists created_at timestamptz not null default now()
  `);

  await client.query(`
    alter table weekly_goal_entries
    add column if not exists updated_at timestamptz not null default now()
  `);

  await client.query(`
    alter table meta_people
    add column if not exists created_at timestamptz not null default now()
  `);

  await client.query(`
    alter table meta_people
    add column if not exists updated_at timestamptz not null default now()
  `);

  const activeCount = await client.query(`
    select count(*)::int as count
    from meta_people
    where active = true
  `);

  if (Number(activeCount.rows[0]?.count || 0) === 0) {
    for (const nome of sortNames(DEFAULT_MEMBERS)) {
      await client.query(
        `
        insert into meta_people (person_name, person_type, active)
        values ($1, 'membro', true)
        on conflict (person_name)
        do update set
          person_type = excluded.person_type,
          active = true,
          updated_at = now()
        `,
        [nome]
      );
    }

    for (const nome of sortNames(DEFAULT_PROSPECTS)) {
      await client.query(
        `
        insert into meta_people (person_name, person_type, active)
        values ($1, 'prospect', true)
        on conflict (person_name)
        do update set
          person_type = excluded.person_type,
          active = true,
          updated_at = now()
        `,
        [nome]
      );
    }
  }

  for (const nome of REMOVED_NAMES) {
    await client.query(
      `delete from meta_people where lower(trim(person_name)) = lower(trim($1))`,
      [nome]
    );

    await client.query(
      `delete from weekly_goal_entries where lower(trim(person_name)) = lower(trim($1))`,
      [nome]
    );
  }
}

async function getActiveRosterRows(client) {
  const res = await client.query(`
    select person_name, person_type
    from meta_people
    where active = true
    order by person_type asc, person_name asc
  `);

  return res.rows.map((row) => ({
    person_name: cleanName(row.person_name),
    person_type: row.person_type
  }));
}

async function getRoster(client) {
  const rows = await getActiveRosterRows(client);

  return {
    members: sortNames(rows.filter((row) => row.person_type === 'membro').map((row) => row.person_name)),
    prospects: sortNames(rows.filter((row) => row.person_type === 'prospect').map((row) => row.person_name))
  };
}

async function getLatestWeek(client) {
  const res = await client.query(`
    select id, week_number, week_start
    from weekly_goals
    order by week_number desc
    limit 1
  `);

  return res.rows[0] || null;
}

async function syncWeekEntriesToRoster(client, weeklyGoalId, rosterRows) {
  const rosterMap = new Map(
    rosterRows.map((row) => [normalizeName(row.person_name), row])
  );

  const existing = await client.query(
    `
    select id, person_name, person_type, amount, status, justification
    from weekly_goal_entries
    where weekly_goal_id = $1
    order by id asc
    `,
    [weeklyGoalId]
  );

  const matched = new Set();

  for (const row of existing.rows) {
    const key = normalizeName(row.person_name);
    const rosterPerson = rosterMap.get(key);

    if (!rosterPerson) {
      await client.query(`delete from weekly_goal_entries where id = $1`, [row.id]);
      continue;
    }

    matched.add(key);

    await client.query(
      `
      insert into weekly_goal_entries (
        weekly_goal_id, person_name, person_type, amount, status, justification
      )
      values ($1, $2, $3, $4, $5, $6)
      on conflict (weekly_goal_id, person_name, person_type)
      do update set
        amount = excluded.amount,
        status = excluded.status,
        justification = excluded.justification,
        updated_at = now()
      `,
      [
        weeklyGoalId,
        rosterPerson.person_name,
        rosterPerson.person_type,
        Number(row.amount || 0),
        VALID_STATUS.has(row.status) ? row.status : 'pendente',
        row.justification || ''
      ]
    );

    const targetRow = await client.query(
      `
      select id
      from weekly_goal_entries
      where weekly_goal_id = $1
        and person_name = $2
        and person_type = $3
      limit 1
      `,
      [weeklyGoalId, rosterPerson.person_name, rosterPerson.person_type]
    );

    const keepId = targetRow.rows[0]?.id;

    await client.query(
      `
      delete from weekly_goal_entries
      where weekly_goal_id = $1
        and lower(trim(person_name)) = lower(trim($2))
        and id <> $3
      `,
      [weeklyGoalId, rosterPerson.person_name, keepId || 0]
    );
  }

  for (const rosterPerson of rosterRows) {
    const key = normalizeName(rosterPerson.person_name);

    if (matched.has(key)) continue;

    await client.query(
      `
      insert into weekly_goal_entries (
        weekly_goal_id, person_name, person_type, amount, status, justification
      )
      values ($1, $2, $3, 0, 'pendente', '')
      on conflict (weekly_goal_id, person_name, person_type) do nothing
      `,
      [weeklyGoalId, rosterPerson.person_name, rosterPerson.person_type]
    );
  }
}

async function ensureWeek(client, requestedWeekNumber = null) {
  await ensureMetaSchema(client);

  const weekStart = startOfWeekString();
  const latestWeek = await getLatestWeek(client);

  let finalWeekNumber = Number(requestedWeekNumber);
  if (!Number.isFinite(finalWeekNumber) || finalWeekNumber <= 0) {
    finalWeekNumber = latestWeek?.week_number ? Number(latestWeek.week_number) : 1;
  }

  let res = await client.query(
    `select id, week_number, week_start from weekly_goals where week_number = $1`,
    [finalWeekNumber]
  );

  if (!res.rows.length) {
    const insertWeek = await client.query(
      `
      insert into weekly_goals (week_number, week_start)
      values ($1, $2)
      on conflict (week_number) do update set week_start = excluded.week_start
      returning id, week_number, week_start
      `,
      [finalWeekNumber, weekStart]
    );

    res = { rows: [insertWeek.rows[0]] };
  }

  const weeklyGoal = res.rows[0];
  const rosterRows = await getActiveRosterRows(client);
  await syncWeekEntriesToRoster(client, weeklyGoal.id, rosterRows);

  return weeklyGoal;
}

async function findRosterPerson(client, personName) {
  const nome = cleanName(personName);
  const res = await client.query(
    `
    select id, person_name, person_type, active
    from meta_people
    where lower(trim(person_name)) = lower(trim($1))
    limit 1
    `,
    [nome]
  );

  return res.rows[0] || null;
}

async function addRosterPerson(client, personName, personType, weekNumber) {
  const nome = cleanName(personName);
  const tipo = String(personType || '').trim();

  if (!nome) {
    throw new Error('Nome é obrigatório.');
  }

  if (!VALID_PERSON_TYPES.has(tipo)) {
    throw new Error('Tipo de pessoa inválido.');
  }

  const existing = await findRosterPerson(client, nome);

  if (existing?.active) {
    throw new Error('Esse nome já existe no quadro.');
  }

  if (existing) {
    await client.query(
      `
      update meta_people
      set person_name = $1,
          person_type = $2,
          active = true,
          updated_at = now()
      where id = $3
      `,
      [nome, tipo, existing.id]
    );
  } else {
    await client.query(
      `
      insert into meta_people (person_name, person_type, active)
      values ($1, $2, true)
      `,
      [nome, tipo]
    );
  }

  await ensureWeek(client, Number(weekNumber || 0));
}

async function promoteRosterPerson(client, personName, weekNumber) {
  const existing = await findRosterPerson(client, personName);

  if (!existing || !existing.active) {
    throw new Error('Prospect não encontrado no quadro.');
  }

  if (existing.person_type === 'membro') {
    return;
  }

  await client.query(
    `
    update meta_people
    set person_type = 'membro', updated_at = now()
    where id = $1
    `,
    [existing.id]
  );

  await ensureWeek(client, Number(weekNumber || 0));
}

async function removeRosterPerson(client, personName, weekNumber) {
  const existing = await findRosterPerson(client, personName);

  if (!existing) {
    throw new Error('Pessoa não encontrada no quadro.');
  }

  await client.query(`delete from meta_people where id = $1`, [existing.id]);

  await ensureWeek(client, Number(weekNumber || 0));
}

export default {
  async fetch(request) {
    const client = await pool.connect();

    try {
      if (request.method === 'GET') {
        const url = new URL(request.url);
        const weekParam = url.searchParams.get('week');
        const weekNumber = weekParam ? Number(weekParam) : null;

        const weeklyGoal = await ensureWeek(client, weekNumber);
        const roster = await getRoster(client);

        const entries = await client.query(
          `
          select
            id,
            person_name,
            person_type,
            amount,
            status,
            justification
          from weekly_goal_entries
          where weekly_goal_id = $1
          order by person_type asc, person_name asc
          `,
          [weeklyGoal.id]
        );

        const history = await client.query(
          `
          select
            wg.id,
            wg.week_number,
            wg.week_start,
            coalesce(
              json_agg(
                json_build_object(
                  'id', wge.id,
                  'person_name', wge.person_name,
                  'person_type', wge.person_type,
                  'amount', wge.amount,
                  'status', wge.status,
                  'justification', wge.justification
                )
                order by wge.person_type asc, wge.person_name asc
              ) filter (where wge.id is not null),
              '[]'::json
            ) as entries
          from weekly_goals wg
          left join weekly_goal_entries wge on wge.weekly_goal_id = wg.id
          where wg.week_number < $1
          group by wg.id
          order by wg.week_number desc
          `,
          [weeklyGoal.week_number]
        );

        return new Response(JSON.stringify({
          week: weeklyGoal,
          roster,
          entries: entries.rows,
          history: history.rows
        }), {
          headers: { 'content-type': 'application/json' }
        });
      }

      if (request.method === 'POST') {
        const body = await request.json();
        const {
          weekNumber,
          personName,
          personType,
          amount,
          status,
          justification
        } = body;

        if (!personName || !personType) {
          return new Response(JSON.stringify({ error: 'Dados obrigatórios ausentes' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        if (!VALID_PERSON_TYPES.has(String(personType || '').trim())) {
          return new Response(JSON.stringify({ error: 'Tipo de pessoa inválido' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        const statusFinal = VALID_STATUS.has(String(status || '').trim()) ? String(status).trim() : 'pendente';

        await client.query('begin');

        const weeklyGoal = await ensureWeek(client, Number(weekNumber || 0));

        await client.query(
          `
          insert into weekly_goal_entries (
            weekly_goal_id, person_name, person_type, amount, status, justification
          )
          values ($1,$2,$3,$4,$5,$6)
          on conflict (weekly_goal_id, person_name, person_type)
          do update set
            amount = excluded.amount,
            status = excluded.status,
            justification = excluded.justification,
            updated_at = now()
          `,
          [
            weeklyGoal.id,
            cleanName(personName),
            String(personType).trim(),
            Number(amount || 0),
            statusFinal,
            statusFinal === 'justificado' ? String(justification || '') : ''
          ]
        );

        await client.query('commit');

        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' }
        });
      }

      if (request.method === 'PUT') {
        const body = await request.json();
        const { currentWeekNumber } = body;
        await ensureMetaSchema(client);
        const latestWeek = await getLatestWeek(client);
        const baseWeekNumber = Math.max(Number(currentWeekNumber || 0), Number(latestWeek?.week_number || 0), 0);
        const newWeekNumber = baseWeekNumber + 1;

        await ensureWeek(client, newWeekNumber);

        return new Response(JSON.stringify({
          ok: true,
          weekNumber: newWeekNumber
        }), {
          headers: { 'content-type': 'application/json' }
        });
      }

      if (request.method === 'PATCH') {
        const body = await request.json();
        const { action, weekNumber, personName, personType } = body;

        await ensureMetaSchema(client);
        await client.query('begin');

        if (action === 'add') {
          await addRosterPerson(client, personName, personType, weekNumber);
        } else if (action === 'promote') {
          await promoteRosterPerson(client, personName, weekNumber);
        } else if (action === 'remove') {
          await removeRosterPerson(client, personName, weekNumber);
        } else {
          await client.query('rollback');
          return new Response(JSON.stringify({ error: 'Ação inválida' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        await client.query('commit');

        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'content-type': 'application/json' }
      });
    } catch (error) {
      try { await client.query('rollback'); } catch {}
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'content-type': 'application/json' }
      });
    } finally {
      client.release();
    }
  }
};
