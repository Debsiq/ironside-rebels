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

      if (total == null || Number.isNaN(Number(total)) || Number(total) <= 0) {
        return new Response(JSON.stringify({ error: 'Total da encomenda inválido.' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }

      await client.query('BEGIN');

      // Gera automaticamente o próximo número se o frontend mandar vazio/repetido
      let finalPurchaseNumber = Number(purchaseNumber);

      if (!finalPurchaseNumber || Number.isNaN(finalPurchaseNumber)) {
        const nextNumberRes = await client.query(`
          select coalesce(max(purchase_number), 0) + 1 as next_number
          from purchases
        `);
        finalPurchaseNumber = Number(nextNumberRes.rows[0].next_number);
      } else {
        const existsRes = await client.query(
          `select 1 from purchases where purchase_number = $1 limit 1`,
          [finalPurchaseNumber]
        );

        if (existsRes.rowCount > 0) {
          const nextNumberRes = await client.query(`
            select coalesce(max(purchase_number), 0) + 1 as next_number
            from purchases
          `);
          finalPurchaseNumber = Number(nextNumberRes.rows[0].next_number);
        }
      }

      const purchaseResult = await client.query(
        `
        insert into purchases (
          purchase_number,
          buyer_name,
          seller_name,
          total
        )
        values ($1,$2,$3,$4)
        returning id, purchase_number
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
        if (
          !item?.category ||
          !item?.productName ||
          !item?.supplierName ||
          !item?.quantity ||
          !item?.paymentType ||
          item?.unitPrice == null ||
          item?.total == null
        ) {
          throw new Error('Um ou mais itens da encomenda estão incompletos.');
        }

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

      await client.query('COMMIT');

      return new Response(JSON.stringify({
        ok: true,
        id: purchaseId,
        purchaseNumber: purchaseResult.rows[0].purchase_number,
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
