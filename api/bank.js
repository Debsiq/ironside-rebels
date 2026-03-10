import { pool } from './_db.js';

async function getBankSummary(client) {
  const movementsRes = await client.query(`
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

  const movements = movementsRes.rows;

  let clean = 0;
  let dirty = 0;

  for (const movement of movements) {
    const amount = Number(movement.amount || 0);

    if (movement.type === 'limpo') {
      clean += movement.action === 'entrada' ? amount : -amount;
    }

    if (movement.type === 'sujo') {
      dirty += movement.action === 'entrada' ? amount : -amount;
    }
  }

  return {
    clean: Math.max(0, clean),
    dirty: Math.max(0, dirty),
    movements
  };
}

export default {
  async fetch(request) {
    const client = await pool.connect();

    try {
      if (request.method === 'GET') {
        const summary = await getBankSummary(client);

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

        const current = await getBankSummary(client);
        const currentBalance = type === 'limpo' ? current.clean : current.dirty;

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

        const updated = await getBankSummary(client);

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
