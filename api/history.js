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
      const url = new URL(request.url);
      const sort = url.searchParams.get('sort') === 'oldest' ? 'asc' : 'desc';
      const buyer = (url.searchParams.get('buyer') || '').trim();
      const seller = (url.searchParams.get('seller') || '').trim();

      const orderWhere = [];
      const orderParams = [];
      let idx = 1;

      if (buyer) {
        orderWhere.push(`o.buyer_name ilike $${idx++}`);
        orderParams.push(`%${buyer}%`);
      }

      if (seller) {
        orderWhere.push(`coalesce(o.seller_name, '') ilike $${idx++}`);
        orderParams.push(`%${seller}%`);
      }

      const ordersQuery = `
        select
          o.id,
          o.order_number,
          o.buyer_name,
          o.seller_name,
          o.payment_type,
          o.total_weapons,
          o.discount_eligible_weapons,
          o.subtotal,
          o.discount_value,
          o.total,
          o.created_at,
          coalesce(
            json_agg(
              json_build_object(
                'weapon', oi.weapon_name,
                'quantity', oi.quantity,
                'unitPrice', oi.unit_price,
                'subtotal', oi.subtotal,
                'eligibleDiscount', oi.eligible_discount
              )
              order by oi.id
            ) filter (where oi.id is not null),
            '[]'::json
          ) as items
        from orders o
        left join order_items oi on oi.order_id = o.id
        ${orderWhere.length ? `where ${orderWhere.join(' and ')}` : ''}
        group by o.id
        order by o.created_at ${sort}
      `;

      const purchaseWhere = [];
      const purchaseParams = [];
      let idx2 = 1;

      if (buyer) {
        purchaseWhere.push(`coalesce(p.buyer_name, '') ilike $${idx2++}`);
        purchaseParams.push(`%${buyer}%`);
      }

      if (seller) {
        purchaseWhere.push(`coalesce(p.seller_name, '') ilike $${idx2++}`);
        purchaseParams.push(`%${seller}%`);
      }

      const purchasesQuery = `
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
        ${purchaseWhere.length ? `where ${purchaseWhere.join(' and ')}` : ''}
        group by p.id
        order by p.created_at ${sort}
      `;

      const [ordersRes, purchasesRes] = await Promise.all([
        pool.query(ordersQuery, orderParams),
        pool.query(purchasesQuery, purchaseParams),
      ]);

      return new Response(JSON.stringify({
        orders: ordersRes.rows,
        purchases: purchasesRes.rows,
      }), {
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
