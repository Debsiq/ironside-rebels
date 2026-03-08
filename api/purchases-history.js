import { pool } from './_db.js';

export default {
  async fetch(request) {
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      });
    }

    try {
      const result = await pool.query(`
        select
          p.id,
          p.purchase_number,
          p.buyer_name,
          p.seller_name,
          p.total,
          p.created_at,
          coalesce(
            json_agg(
              json_build_object(
                'category', pi.category,
                'productName', pi.product_name,
                'supplierName', pi.supplier_name,
                'quantity', pi.quantity,
                'paymentType', pi.payment_type,
                'unitPrice', pi.unit_price,
                'total', pi.total,
                'obs', pi.obs
              )
              order by pi.id
            ) filter (where pi.id is not null),
            '[]'::json
          ) as items
        from purchases p
        left join purchase_items pi on pi.purchase_id = p.id
        group by p.id
        order by p.created_at desc, p.id desc
      `);

      return new Response(JSON.stringify({
        ok: true,
        count: result.rows.length,
        purchases: result.rows,
      }), {
        headers: { 'content-type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        error: error.message || 'Erro ao carregar histórico de encomendas.',
      }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  },
};
