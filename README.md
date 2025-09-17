# Helldivers 2 Companion

A real-time companion app for Helldivers 2 game data. Track war status, campaigns, news, and statistics. This is the second version, rewritten for better maintainability.

## Features

- Real-time war status and galactic progress
- Active planet liberation campaigns
- Game news and updates
- War statistics and metrics

## Getting Started

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

First, install the packages and run the development server:

```bash
pnpm install
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing pages by modifying `.tsx` files. The page auto-updates as you edit the file.

## Model Context Protocol connector

This repository ships with an MCP (Model Context Protocol) server that exposes Helldivers 2 data to ChatGPT via stdio. The server
resides in `connectors/helldivers-mcp/` and reuses the shared `lib/get.ts` helpers to communicate with `https://api.helldivers2.dev`.

### Run locally

```bash
pnpm install
pnpm run connectors:dev
```

The development command runs the server with hot reloading through `tsx`. It logs a confirmation message once a client connects.

To type-check the connector and run the server:

```bash
pnpm run connectors:start
```

This script type-checks the MCP connector before launching the stdio server.

### Configure ChatGPT

In the ChatGPT “Connectors” form choose **Custom**, then provide the following command configuration:

- **Command:** `pnpm`
- **Arguments:** `run`, `connectors:start`
- **Working directory:** Root of this repository

Because the connector uses stdio transport no additional network port configuration is required. The exposed tools include
`getWarStatus`, `getDispatches`, `getMajorOrders`, and `getActiveCampaigns`, each returning structured JSON payloads with built-in
timeouts and rate limiting suitable for conversational use.

### Guía rápida en español

1. **Instala las dependencias**
   - Asegúrate de tener [pnpm](https://pnpm.io/installation) instalado.
   - Ejecuta `pnpm install` en la raíz del repositorio para preparar todas las dependencias del monorrepo y del conector MCP.
2. **Prueba el servidor MCP en local**
   - Lanza `pnpm run connectors:dev` para iniciar el servidor con recarga en caliente.
   - En la terminal deberías ver el mensaje `[helldivers-mcp] Server ready and listening on stdio.` indicando que todo está listo.
3. **Configura el conector en ChatGPT**
   - En ChatGPT abre la sección **Connectors** y elige la opción **Custom**.
   - Introduce lo siguiente en el formulario:
     - **Command:** `pnpm`
     - **Arguments:** `run`, `connectors:start`
     - **Working directory:** la ruta del repositorio que contiene este proyecto.
   - Guarda la configuración. ChatGPT ejecutará el comando anterior y conectará vía stdio con el servidor MCP.
4. **Usa las herramientas disponibles**
   - Desde ChatGPT podrás invocar herramientas como `getWarStatus`, `getDispatches`, `getMajorOrders` o `getActiveCampaigns`.
   - Cada herramienta valida los parámetros de entrada, impone un límite de peticiones para evitar abusos y responde con JSON fácil de consumir en la conversación.

## Contributing

Contributions are welcome! Fork the repo, make your changes, and submit a pull request.

## Learn More

To learn more about Next.js:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial

Your feedback and contributions are welcome!
