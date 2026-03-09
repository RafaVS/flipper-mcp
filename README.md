# Flipper MCP Server

Servidor MCP (Model Context Protocol) que conecta LLMs con Flipper Desktop para depurar aplicaciones Android en tiempo real.

## Herramientas disponibles

### Device & App

| Tool | Descripcion |
|------|-------------|
| `flipper_list_devices` | Lista dispositivos conectados (serial, OS, tipo, estado) |
| `flipper_list_apps` | Lista apps conectadas con client ID, nombre, SDK version |
| `flipper_shell_exec` | Ejecuta comandos ADB shell en el dispositivo |
| `flipper_navigate` | Navega a un deep link URI en el dispositivo |
| `flipper_take_screenshot` | Captura screenshot del dispositivo (devuelve imagen PNG) |

### Logs & Crashes

| Tool | Descripcion |
|------|-------------|
| `flipper_get_android_logs` | Logs del dispositivo con filtro por tag y nivel |
| `flipper_clear_logs` | Limpia el buffer local de logs |
| `flipper_get_crashes` | Crash reports capturados del dispositivo |
| `flipper_clear_crashes` | Limpia el buffer local de crashes |

### Network & Analytics

| Tool | Descripcion |
|------|-------------|
| `flipper_get_network_requests` | Peticiones de red con request/response pareados |
| `flipper_get_analytics_events` | Eventos de analytics (GA, AppsFlyer, etc.) |

### Network Mocking

Intercepta peticiones de red en la app Android y devuelve respuestas configuradas, sin necesidad de modificar el servidor real. Funciona tanto para peticiones **REST** (plugin nativo `Network`) como **GraphQL** (plugin `Network GraphQL`).

| Tool | Descripcion |
|------|-------------|
| `flipper_add_mock` | Añade o actualiza un mock para una URL y metodo HTTP |
| `flipper_remove_mock` | Elimina un mock especifico |
| `flipper_list_mocks` | Lista todos los mocks activos |
| `flipper_clear_mocks` | Elimina todos los mocks y restaura el trafico real |

**Como funciona el enrutado:**

- Si se especifica `operation` (nombre de operacion GraphQL) → el mock se envia al plugin `Network GraphQL`
- Si `operation` esta vacio → el mock se envia al plugin nativo `Network` (REST)

**Ejemplos de uso:**

Mock de una operacion GraphQL que devuelve error 500:
```
flipper_add_mock({
  requestUrl: "https://api.example.com/graphql",
  operation: "GetHotel",
  method: "POST",
  status: 500,
  data: '{"errors":[{"message":"Internal Server Error"}]}'
})
```

Mock de un endpoint REST que devuelve lista vacia:
```
flipper_add_mock({
  requestUrl: "https://api.example.com/hotels",
  method: "GET",
  status: 200,
  data: '{"hotels":[]}'
})
```

### Data & State

| Tool | Descripcion |
|------|-------------|
| `flipper_get_viewmodel_states` | Cambios de estado de ViewModels |
| `flipper_get_preferences` | Lee SharedPreferences y DataStore |
| `flipper_set_preference` | Escribe un valor en SharedPreferences |
| `flipper_delete_preference` | Elimina una clave de SharedPreferences |
| `flipper_database_list` | Lista bases de datos SQLite/Room y sus tablas |
| `flipper_database_query` | Ejecuta queries SQL (SELECT, INSERT, UPDATE, DELETE) |
| `flipper_database_get_table` | Obtiene datos paginados de una tabla |
| `flipper_database_get_structure` | Obtiene el schema de una tabla (columnas, tipos, indices) |

### UI Inspection

| Tool | Descripcion |
|------|-------------|
| `flipper_get_view_tree` | Obtiene la jerarquia de vistas con profundidad configurable |
| `flipper_get_node_details` | Inspecciona nodos UI por ID (atributos, layout, propiedades) |
| `flipper_search_view` | Busca elementos en la jerarquia de vistas por texto |

### Memory & Push

| Tool | Descripcion |
|------|-------------|
| `flipper_get_leaks` | Memory leaks capturados por LeakCanary (v1 y v2) |
| `flipper_clear_leaks` | Limpia el buffer local de leaks |
| `flipper_send_fcm` | Envia notificaciones push FCM v1 |

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
    device.ts           # Resolucion de dispositivos y clientes
    types.ts            # Tipos de mensajes Flipper
  tools/
    logs.ts             # Logs del dispositivo
    analytics.ts        # Eventos de analytics
    network.ts          # Peticiones de red
    mock.ts             # Mocking de respuestas de red (REST y GraphQL)
    viewmodel.ts        # Estado de ViewModels
    preferences.ts      # SharedPreferences / DataStore (lectura y escritura)
    fcm.ts              # Envio de push notifications FCM
    crashreporter.ts    # Crash reports
    screenshot.ts       # Capturas de pantalla
    database.ts         # Bases de datos SQLite/Room
    shell.ts            # Comandos ADB shell
    navigate.ts         # Navegacion por deep links
    ui-inspector.ts     # Inspeccion de jerarquia de vistas
    leaks.ts            # Memory leaks (LeakCanary)
    device-info.ts      # Info de dispositivos y apps conectadas
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
