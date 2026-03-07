import { pool } from './_db.js';

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      });
    }

    const client = await pool.connect();

    try {
      const body = await request.json();
      const {
        orderNumber,
        buyerName,
        sellerName,
        paymentType,
        totalWeapons,
        discountEligibleWeapons,
        subtotal,
        discountValue,
        total,
        items,
      } = body;

      await client.query('BEGIN');

      const orderResult = await client.query(
        `
        insert into orders (
          order_number,
          buyer_name,
          seller_name,
          payment_type,
          total_weapons,
          discount_eligible_weapons,
          subtotal,
          discount_value,
          total
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        returning id
        `,
        [
          orderNumber,
          buyerName,
          sellerName || null,
          paymentType,
          totalWeapons,
          discountEligibleWeapons,
          subtotal,
          discountValue,
          total,
        ]
      );

      const orderId = orderResult.rows[0].id;

      for (const item of items) {
        await client.query(
          `
          insert into order_items (
            order_id,
            weapon_name,
            quantity,
            unit_price,
            subtotal,
            eligible_discount
          )
          values ($1,$2,$3,$4,$5,$6)
          `,
          [
            orderId,
            item.weapon,
            item.quantity,
            item.unitPrice,
            item.subtotal,
            item.eligibleDiscount,
          ]
        );
      }

      await client.query('COMMIT');

      return new Response(JSON.stringify({ ok: true, id: orderId }), {
        headers: { 'content-type': 'application/json' },
      });
    } catch (error) {
      await client.query('ROLLBACK');

      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    } finally {
      client.release();
    }
  },
};
