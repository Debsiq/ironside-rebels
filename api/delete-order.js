import { pool } from './_db.js';

export default {
  async fetch(request) {
    if (request.method !== 'DELETE') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      });
    }

    try {
      const body = await request.json();
      const { id } = body;

      if (!id) {
        return new Response(JSON.stringify({ error: 'ID obrigatório' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }

      await pool.query('delete from orders where id = $1', [id]);

      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  },
};
