import { pool } from './_db.js';

async function getBankSummary(client, filterType = null) {
  const allowedTypes = ['limpo', 'sujo'];
  const validFilter = allowedTypes.includes(filterType) ? filterType : null;

  const movementsRes = validFilter
    ? await client.query(
        `
        select
          id,
          action,
          type,
          amount,
          reason,
          created_at
        from bank_movements
        where type = $1
        order by created_at desc, id desc
        `,
        [validFilter]
      )
    : await client.query(`
        select
          id,
          action,
          type,
          amount,
          reason,
          created_at
        from bank_movements
        order by created_at desc, id desc
      `);

  const totalsRes = await client.query(`
    select
      coalesce(sum(case when type = 'limpo' and action = 'entrada' then amount when type = 'limpo' and action = 'saida' then -amount else 0 end), 0) as clean,
      coalesce(sum(case when type = 'sujo' and action = 'entrada' then amount when type = 'sujo' and action = 'saida' then -amount else 0 end), 0) as dirty
    from bank_movements
  `);

  const totals = totalsRes.rows[0] || { clean: 0, dirty: 0 };

  return {
    clean: Math.max(0, Number(totals.clean || 0)),
    dirty: Math.max(0, Number(totals.dirty || 0)),
    movements: movementsRes.rows
  };
}

async function getCurrentBalanceByType(client, type) {
  const res = await client.query(
    `
    select
      coalesce(sum(case when action = 'entrada' then amount when action = 'saida' then -amount else 0 end), 0) as balance
    from bank_movements
    where type = $1
    `,
    [type]
  );

  return Math.max(0, Number(res.rows[0]?.balance || 0));
}

export default {
  async fetch(request) {
    const client = await pool.connect();

    try {
      const url = new URL(request.url);
      const filterType = url.searchParams.get('type');

      if (request.method === 'GET') {
        const summary = await getBankSummary(client, filterType);

        return new Response(JSON.stringify(summary), {
          headers: { 'content-type': 'application/json' }
        });
      }

      if (request.method === 'POST') {
        const body = await request.json();
        const action = String(body.action || '').trim();
        const type = String(body.type || '').trim();
        const amount = Number(body.amount || 0);
        const reason = String(body.reason || '').trim();

        if (!['entrada', 'saida'].includes(action)) {
          return new Response(JSON.stringify({ error: 'Ação inválida.' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        if (!['limpo', 'sujo'].includes(type)) {
          return new Response(JSON.stringify({ error: 'Tipo inválido.' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        if (!Number.isFinite(amount) || amount <= 0) {
          return new Response(JSON.stringify({ error: 'Valor inválido.' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        if (!reason) {
          return new Response(JSON.stringify({ error: 'Motivo é obrigatório.' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        await client.query('begin');

        const currentBalance = await getCurrentBalanceByType(client, type);

        if (action === 'saida' && currentBalance < amount) {
          await client.query('rollback');

          return new Response(JSON.stringify({
            error: `Saldo ${type} insuficiente. Saldo atual: ${currentBalance}`
          }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        await client.query(
          `
          insert into bank_movements (action, type, amount, reason)
          values ($1, $2, $3, $4)
          `,
          [action, type, amount, reason]
        );

        await client.query('commit');

        const updated = await getBankSummary(client, filterType);

        return new Response(JSON.stringify(updated), {
          headers: { 'content-type': 'application/json' }
        });
      }

      if (request.method === 'PUT') {
        const body = await request.json();
        const id = Number(body.id || 0);
        const action = String(body.action || '').trim();
        const type = String(body.type || '').trim();
        const amount = Number(body.amount || 0);
        const reason = String(body.reason || '').trim();

        if (!id || id <= 0) {
          return new Response(JSON.stringify({ error: 'ID inválido.' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        if (!['entrada', 'saida'].includes(action)) {
          return new Response(JSON.stringify({ error: 'Ação inválida.' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        if (!['limpo', 'sujo'].includes(type)) {
          return new Response(JSON.stringify({ error: 'Tipo inválido.' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        if (!Number.isFinite(amount) || amount <= 0) {
          return new Response(JSON.stringify({ error: 'Valor inválido.' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        if (!reason) {
          return new Response(JSON.stringify({ error: 'Motivo é obrigatório.' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        await client.query('begin');

        const existingRes = await client.query(
          `
          select id, action, type, amount, reason
          from bank_movements
          where id = $1
          `,
          [id]
        );

        if (!existingRes.rows.length) {
          await client.query('rollback');
          return new Response(JSON.stringify({ error: 'Movimentação não encontrada.' }), {
            status: 404,
            headers: { 'content-type': 'application/json' }
          });
        }

        const existing = existingRes.rows[0];

        await client.query(`delete from bank_movements where id = $1`, [id]);

        const currentBalance = await getCurrentBalanceByType(client, type);

        if (action === 'saida' && currentBalance < amount) {
          await client.query('rollback');

          return new Response(JSON.stringify({
            error: `Saldo ${type} insuficiente para essa edição.`
          }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        await client.query(
          `
          insert into bank_movements (id, action, type, amount, reason, created_at)
          values ($1, $2, $3, $4, $5, now())
          `,
          [id, action, type, amount, reason]
        );

        await client.query('commit');

        const updated = await getBankSummary(client, filterType);

        return new Response(JSON.stringify(updated), {
          headers: { 'content-type': 'application/json' }
        });
      }

      if (request.method === 'DELETE') {
        const body = await request.json();
        const id = Number(body.id || 0);

        if (!id || id <= 0) {
          return new Response(JSON.stringify({ error: 'ID inválido.' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        await client.query('begin');

        const existingRes = await client.query(
          `
          select id
          from bank_movements
          where id = $1
          `,
          [id]
        );

        if (!existingRes.rows.length) {
          await client.query('rollback');
          return new Response(JSON.stringify({ error: 'Movimentação não encontrada.' }), {
            status: 404,
            headers: { 'content-type': 'application/json' }
          });
        }

        await client.query(`delete from bank_movements where id = $1`, [id]);

        await client.query('commit');

        const updated = await getBankSummary(client, filterType);

        return new Response(JSON.stringify(updated), {
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
