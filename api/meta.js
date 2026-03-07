import { pool } from './_db.js';

const membrosMeta = [
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
  'Isaiah D\'Lenfer',
  'Tristan D\'Lenfer',
  'Angelique "Angel" Melbourne',
  'Kaleb Chester',
  'Søren "Caju" D\'Ulven',
  'Matteo "Tet" Brown',
  'Baltazar "Bills" D\'Lenfer'
];

const prospectsMeta = [
  'Aurora "Castillo" Castillo',
  'Jorsh Garcia',
  'Rebecca "Belladonna" Celestine',
  'Amanda "Valquíria" Winters',
  'Amora Corvus',
  'Carraig "Corvo" Dubhghaill',
  'Jesse "Foster" Foster'
];

function startOfWeekString() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

async function ensureWeek(client, weekNumber) {
  const weekStart = startOfWeekString();

  let res = await client.query(
    `select id, week_number, week_start from weekly_goals where week_number = $1`,
    [weekNumber]
  );

  if (res.rows.length) return res.rows[0];

  const insertWeek = await client.query(
    `
    insert into weekly_goals (week_number, week_start)
    values ($1, $2)
    on conflict (week_number) do update set week_start = excluded.week_start
    returning id, week_number, week_start
    `,
    [weekNumber, weekStart]
  );

  const weeklyGoal = insertWeek.rows[0];

  for (const nome of membrosMeta) {
    await client.query(
      `
      insert into weekly_goal_entries (
        weekly_goal_id, person_name, person_type, amount, status, justification
      )
      values ($1,$2,'membro',0,'pendente','')
      on conflict (weekly_goal_id, person_name, person_type) do nothing
      `,
      [weeklyGoal.id, nome]
    );
  }

  for (const nome of prospectsMeta) {
    await client.query(
      `
      insert into weekly_goal_entries (
        weekly_goal_id, person_name, person_type, amount, status, justification
      )
      values ($1,$2,'prospect',0,'pendente','')
      on conflict (weekly_goal_id, person_name, person_type) do nothing
      `,
      [weeklyGoal.id, nome]
    );
  }

  return weeklyGoal;
}

export default {
  async fetch(request) {
    const client = await pool.connect();

    try {
      if (request.method === 'GET') {
        const url = new URL(request.url);
        const weekNumber = Number(url.searchParams.get('week') || 0);

        const weeklyGoal = await ensureWeek(client, weekNumber);

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

        return new Response(JSON.stringify({
          week: weeklyGoal,
          entries: entries.rows
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
            justification = excluded.justification
          `,
          [
            weeklyGoal.id,
            personName,
            personType,
            Number(amount || 0),
            status || 'pendente',
            justification || ''
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
        const newWeekNumber = Number(currentWeekNumber || 0) + 1;

        await ensureWeek(client, newWeekNumber);

        return new Response(JSON.stringify({
          ok: true,
          weekNumber: newWeekNumber
        }), {
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
