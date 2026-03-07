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
        purchaseNumber,
        buyerName,
        sellerName,
        total,
        items,
      } = body;

      await client.query('BEGIN');

      const purchaseResult = await client.query(
        `
        insert into purchases (
          purchase_number,
          buyer_name,
          seller_name,
          total
        )
        values ($1,$2,$3,$4)
        returning id
        `,
        [
          purchaseNumber,
          buyerName || null,
          sellerName || null,
          total,
        ]
      );

      const purchaseId = purchaseResult.rows[0].id;

      for (const item of items) {
        await client.query(
          `
          insert into purchase_items (
            purchase_id,
            category,
            product_name,
            supplier_name,
            quantity,
            payment_type,
            unit_price,
            total,
            obs
          )
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          `,
          [
            purchaseId,
            item.category,
            item.productName,
            item.supplierName,
            item.quantity,
            item.paymentType,
            item.unitPrice,
            item.total,
            item.obs || null,
          ]
        );
      }

      await client.query('COMMIT');

      return new Response(JSON.stringify({ ok: true, id: purchaseId }), {
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
