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

      if (!Array.isArray(items) || items.length === 0) {
        return new Response(JSON.stringify({ error: 'A encomenda precisa ter pelo menos um item.' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }

      await client.query('BEGIN');

      const nextNumberRes = await client.query(`
        select coalesce(max(purchase_number), 0) + 1 as next_number
        from purchases
      `);

      const finalPurchaseNumber =
        Number.isFinite(Number(purchaseNumber)) && Number(purchaseNumber) > 0
          ? Number(purchaseNumber)
          : Number(nextNumberRes.rows[0].next_number);

      const purchaseResult = await client.query(
        `
        insert into purchases (
          purchase_number,
          buyer_name,
          seller_name,
          total
        )
        values ($1,$2,$3,$4)
        returning id, purchase_number, buyer_name, seller_name, total, created_at
        `,
        [
          finalPurchaseNumber,
          buyerName || null,
          sellerName || null,
          Number(total),
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
            Number(item.quantity),
            item.paymentType,
            Number(item.unitPrice),
            Number(item.total),
            item.obs || null,
          ]
        );
      }

      const confirmRes = await client.query(
        `
        select
          p.id,
          p.purchase_number,
          p.buyer_name,
          p.seller_name,
          p.total,
          p.created_at,
          count(pi.id)::int as items_count
        from purchases p
        left join purchase_items pi on pi.purchase_id = p.id
        where p.id = $1
        group by p.id
        `,
        [purchaseId]
      );

      await client.query('COMMIT');

      return new Response(JSON.stringify({
        ok: true,
        saved: confirmRes.rows[0],
      }), {
        headers: { 'content-type': 'application/json' },
      });
    } catch (error) {
      await client.query('ROLLBACK');

      return new Response(JSON.stringify({
        error: error.message || 'Erro ao salvar encomenda.',
      }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    } finally {
      client.release();
    }
  },
};
