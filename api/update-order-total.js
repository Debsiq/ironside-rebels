import { pool } from './_db.js';

export default {
  async fetch(request) {
    if (request.method !== 'PUT') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'content-type': 'application/json' }
      });
    }

    const client = await pool.connect();

    try {
      const body = await request.json();
      const id = Number(body.id || 0);
      const total = Number(body.total || 0);

      if (!id || id <= 0) {
        return new Response(JSON.stringify({ error: 'ID inválido.' }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        });
      }

      if (!Number.isFinite(total) || total <= 0) {
        return new Response(JSON.stringify({ error: 'Total inválido.' }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        });
      }

      const existing = await client.query(
        `select id from orders where id = $1`,
        [id]
      );

      if (!existing.rows.length) {
        return new Response(JSON.stringify({ error: 'Pedido não encontrado.' }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        });
      }

      const updated = await client.query(
        `
        update orders
        set total = $1
        where id = $2
        returning id, total
        `,
        [total, id]
      );

      return new Response(JSON.stringify({
        success: true,
        order: updated.rows[0]
      }), {
        headers: { 'content-type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'content-type': 'application/json' }
      });
    } finally {
      client.release();
    }
  }
};
