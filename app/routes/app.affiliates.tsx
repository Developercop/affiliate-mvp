import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Button,
  TextField,
  Text,
  Modal,
  BlockStack,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const affiliates = await prisma.affiliate.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });
  return json({ affiliates });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "CREATE") {
    const name = formData.get("name") as string;
    const code = formData.get("code") as string;
    
    if (!name || !code) return json({ error: "Missing fields" }, { status: 400 });

    try {
      await prisma.affiliate.create({
        data: {
          shop: session.shop,
          name,
          code: code.toUpperCase(),
        },
      });
      return json({ success: true });
    } catch (e: any) {
      if (e.code === 'P2002') return json({ error: "El código de afiliado ya existe" }, { status: 400 });
      return json({ error: "Error creando afiliado" }, { status: 500 });
    }
  }
  
  if (actionType === "DELETE") {
    const id = formData.get("id") as string;
    await prisma.affiliate.delete({ where: { id, shop: session.shop } });
    return json({ success: true });
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

export default function Affiliates() {
  const { affiliates } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [active, setActive] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const toggleModal = useCallback(() => setActive((active) => !active), []);
  
  const handleCreate = () => {
    fetcher.submit(
      { actionType: "CREATE", name, code },
      { method: "POST" }
    );
    setActive(false);
    setName("");
    setCode("");
  };

  const handleDelete = (id: string) => {
    fetcher.submit({ actionType: "DELETE", id }, { method: "POST" });
  };

  const rowMarkup = affiliates.map(({ id, name, code, createdAt }: any, index: number) => (
    <IndexTable.Row id={id} key={id} position={index}>
      <IndexTable.Cell>{name}</IndexTable.Cell>
      <IndexTable.Cell><Text as="span" fontWeight="bold">{code}</Text></IndexTable.Cell>
      <IndexTable.Cell>{new Date(createdAt).toLocaleDateString()}</IndexTable.Cell>
      <IndexTable.Cell>
        <Button onClick={() => handleDelete(id)} tone="critical" variant="plain">
          Eliminar
        </Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Gestión de Afiliados"
      primaryAction={{
        content: "Añadir afiliado",
        onAction: toggleModal,
      }}
    >
      <Layout>
        <Layout.Section>
          <Card padding="0">
            {fetcher.data?.error && (
              <div style={{ padding: '16px', color: 'red' }}>
                {fetcher.data.error}
              </div>
            )}
            <IndexTable
              resourceName={{ singular: "afiliado", plural: "afiliados" }}
              itemCount={affiliates.length}
              headings={[
                { title: "Nombre Completo" },
                { title: "Código Único" },
                { title: "Fecha" },
                { title: "Acciones" },
              ]}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={active}
        onClose={toggleModal}
        title="Crear nuevo afiliado"
        primaryAction={{
          content: "Guardar",
          onAction: handleCreate,
          loading: fetcher.state === "submitting"
        }}
        secondaryActions={[{ content: "Cancelar", onAction: toggleModal }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="Nombre del afiliado"
              value={name}
              onChange={setName}
              autoComplete="off"
            />
            <TextField
              label="Código Único"
              value={code}
              onChange={(value) => setCode(value.toUpperCase().replace(/\s+/g, ''))}
              autoComplete="off"
              helpText="Ej: TIENDASMART. Formará el link ?ref=TIENDASMART"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
