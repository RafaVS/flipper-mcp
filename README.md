# Flipper MCP Server

Servidor MCP (Model Context Protocol) que conecta LLMs con Flipper Desktop para depurar aplicaciones Android en tiempo real.

## Herramientas disponibles

| Tool | Descripcion |
|------|-------------|
| `get_android_logs` | Logs del dispositivo Android con filtro por tag y nivel |
| `clear_logs` | Limpia el buffer local de logs |
| `flipper_get_analytics_events` | Eventos de Google Analytics y AppsFlyer |
| `flipper_get_network_requests` | Peticiones de red GraphQL y REST con request/response |
| `flipper_get_viewmodel_states` | Cambios de estado de ViewModels |
| `flipper_get_preferences` | SharedPreferences y DataStore |
| `flipper_send_fcm` | Envio de notificaciones push FCM v1 (formato Salesforce MobilePush) |
| `flipper_get_crashes` | Crash reports capturados del dispositivo |
| `flipper_clear_crashes` | Limpia el buffer local de crashes |

## Requisitos

- Node.js v18+
- Flipper Desktop corriendo con WebSocket habilitado (puerto 52342)
- App Android conectada a Flipper

## Instalacion

```bash
npm install
npm run build
```

## Configuracion

El servidor requiere un token de autenticacion de Flipper. Se obtiene de la URL de conexion de Flipper o de sus logs al iniciar.

### Variable de entorno

```bash
FLIPPER_TOKEN="tu_token" npm start
```

### Variables de entorno

| Variable | Requerido | Default | Descripcion |
|----------|-----------|---------|-------------|
| `FLIPPER_TOKEN` | Si | — | Token de autenticacion de Flipper |
| `FLIPPER_HOST` | No | `localhost` | Host donde corre Flipper Desktop |
| `FLIPPER_PORT` | No | `52342` | Puerto WebSocket de Flipper |
| `DEBUG` | No | — | Si esta definido, imprime logs de depuracion a stderr |

### Configuracion en Claude Desktop

Archivo: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "flipper": {
      "command": "node",
      "args": ["/ruta/absoluta/a/flipper-mcp/dist/index.js"],
      "env": {
        "FLIPPER_TOKEN": "tu_token"
      }
    }
  }
}
```

### Configuracion en Claude Code

Archivo: `.mcp.json` en la raiz del proyecto o `~/.claude/mcp.json` global:

```json
{
  "mcpServers": {
    "flipper": {
      "command": "node",
      "args": ["/ruta/absoluta/a/flipper-mcp/dist/index.js"],
      "env": {
        "FLIPPER_TOKEN": "tu_token"
      }
    }
  }
}
```

## Arquitectura

```
src/
  index.ts              # Punto de entrada, registra tools y arranca McpServer
  flipper/
    client.ts           # Cliente WebSocket hacia Flipper Desktop
    types.ts            # Tipos de mensajes Flipper
  tools/
    logs.ts             # Logs del dispositivo
    analytics.ts        # Eventos de analytics (GA, AppsFlyer)
    network.ts          # Peticiones de red (GraphQL, REST)
    viewmodel.ts        # Estado de ViewModels
    preferences.ts      # SharedPreferences / DataStore
    fcm.ts              # Envio de push notifications FCM
    crashreporter.ts    # Crash reports
  utils/
    logger.ts           # Logger con gate DEBUG
```

Cada archivo de tool exporta una funcion `registerXxxTools(server: McpServer)` que registra las herramientas usando `McpServer.registerTool()` con schemas Zod.

El `FlipperClient` mantiene una conexion WebSocket persistente con reconexion automatica. Los datos se almacenan en buffers en memoria con tamano limitado.

## Desarrollo

```bash
npm run build          # Compila TypeScript a dist/
npm start              # Ejecuta el servidor

DEBUG=1 npm start      # Ejecuta con logs de depuracion
```

## Seguridad

- **No comitear el FLIPPER_TOKEN.** Pasarlo siempre via variable de entorno.
- El token expira periodicamente; actualizar en la configuracion cuando sea necesario.

## Licencia

MIT
