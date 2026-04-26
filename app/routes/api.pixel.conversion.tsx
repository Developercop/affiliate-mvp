import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // Solo aceptamos peticiones POST lanzadas desde nuestro Pixel Extension
  if (request.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });

  /*
    En Producción y al estar atado al App Proxy, debemos descomentar esto para validar firmas:
    const { session } = await authenticate.public.appProxy(request); 
    const shop = session.shop;
  */

  const body = await request.json();
  const { affiliateCode, orderId, orderTotal, pixelEventId } = body;

  if (!affiliateCode || !orderId || !orderTotal) {
    return json({ error: "Payload incompleto" }, { status: 400 });
  }

  try {
    // 1. Buscamos al afiliado
    const affiliate = await prisma.affiliate.findFirst({
      where: { code: affiliateCode }
    });

    if (!affiliate) {
      return json({ error: "Afiliado no encontrado" }, { status: 404 });
    }
    
    const shop = affiliate.shop;

    // 2. Traemos la configuración (Regla A.3) para saber cuanto abonarle al afiliado
    const settings = await prisma.shopSettings.findUnique({ where: { shop } });
    const percentToAffiliate = settings?.affiliateCommissionPercent || 5.0;

    // 3. Cálculos de Reglas de Negocio Requeridas:
    const totalVenta = parseFloat(orderTotal);
    
    // Regla D: Tarifa de servicio fija de la aplicación -> 5%
    const appCommission = parseFloat((totalVenta * 0.05).toFixed(2));
    
    // Regla A.3: Comisión del Afiliado según el Merchant
    const affiliateCommission = parseFloat((totalVenta * (percentToAffiliate / 100)).toFixed(2));

    /* 
      4. Emitir el Cargo por Uso vía GraphQL Admin. 
         (Asumimos la existencia de una Suscripción Activa Line Item de tipo USAGE)
    */
    let appUsageChargeId = null;
    try {
      // Creamos una sesión admin (O usamos offline session de la BD)
      const { admin } = await authenticate.admin(new Request(`https://${shop}/admin/api/latest/graphql.json`));
      
      const response = await admin.graphql(
        `mutation usageRecordCreate($description: String!, $price: MoneyInput!, $subscriptionLineItemId: ID!) {
          appUsageRecordCreate(
            description: $description,
            price: $price,
            subscriptionLineItemId: $subscriptionLineItemId
          ) {
            userErrors { field message }
            appUsageRecord { id }
          }
        }`,
        {
          variables: {
            description: `Comisión de infraestructura (5%) por referido ${affiliateCode}`,
            price: { amount: appCommission, currencyCode: "USD" },
            subscriptionLineItemId: "gid://shopify/AppSubscriptionLineItem/12345" // ID Simulado MVP
          }
        }
      );
      
      const payload = await response.json();
      if (payload.data?.appUsageRecordCreate?.appUsageRecord?.id) {
        appUsageChargeId = payload.data.appUsageRecordCreate.appUsageRecord.id;
      }
    } catch (e) {
      console.warn("Simulación completada. En produccion debe habilitarse el Billing Flag en shopify.server.ts", e);
    }

    // 5. Guardar venta en DB (Requiere @@unique constraint de idempotencia)
    await prisma.sale.create({
      data: {
        shop,
        orderId,
        pixelEventId,
        affiliateId: affiliate.id,
        totalAmount: totalVenta,
        appCommission,
        affiliateCommission,
        appUsageChargeId
      }
    });

    return json({ success: true, appCommission, affiliateCommission });

  } catch (error: any) {
    // Si la DB arroja P2002 es un constraint Unique violado porque ya procesamos ese orderId + pixelEvent
    if (error.code === 'P2002') {
      console.log("IDEMPOTENCIA ACTIVADA: Se ignoró el evento duplicado porque ya había sido liquidado en un refresh.");
      return json({ success: true, message: "Evento descartado (Prevención exitosa de doble cobro al Merchant)" });
    }
    
    console.error("Error en Billing Job Serverless:", error);
    return json({ error: "Internal Server Error" }, { status: 500 });
  }
};
