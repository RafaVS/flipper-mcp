# Flipper MCP Server - Especificacion de Plugins

Documento de referencia para implementar un MCP Server que se conecte a una instancia de Flipper Desktop y lea los datos de los plugins custom del proyecto Melia B2C Android.

---

## Arquitectura General

```
Android App (debug) ──WebSocket──> Flipper Desktop ──MCP──> Claude / LLM
                                        │
                                   Plugins Desktop
                                   (.tgz instalados)
```

- **Flipper** usa internamente un protocolo WebSocket para comunicarse entre la app Android y el desktop.
- Los plugins desktop reciben mensajes del dispositivo mediante `client.onMessage(method, callback)`.
- El MCP debe conectarse a la misma instancia de Flipper (o a su API interna) para leer los datos en tiempo real.

---

## Plugins Registrados en la App

En `FlipperUtils.kt` (`app/src/debug/java/com/mo2o/melia/utils/FlipperUtils.kt`) se registran 9 plugins:

| # | Plugin | ID | Custom Desktop | Tipo |
|---|--------|----|----------------|------|
| 1 | CrashReporter | `CrashReporter` | No (nativo) | Device |
| 2 | LeakCanary2 | `LeakCanary2` | No (nativo) | Client |
| 3 | Network (REST) | `Network` | No (nativo) | Client |
| 4 | **Network GraphQL** | `Network GraphQL` | Si | Client |
| 5 | Navigation | `Navigation` | No (nativo) | Client |
| 6 | Databases | `Databases` | No (nativo) | Client |
| 7 | **DataStore/Preferences** | `Preferences` | No (nativo) | Client |
| 8 | **Melia Analytics** | `melia-analytics` | Si | Client |
| 9 | **ViewModel State** | `view-model-state` | Si | Client |

> Los 3 plugins con desktop custom son los `.tgz` en `flipperDesktopPlugins/`.

---

## Plugin 1: Melia Analytics

### Metadata

| Campo | Valor |
|-------|-------|
| **Plugin ID** | `melia-analytics` |
| **Package** | `flipper-plugin-melia-analytics` |
| **Tipo Desktop** | `createTablePlugin` (tabla simple) |
| **Archivo Android** | `app/src/debug/java/com/mo2o/melia/utils/AnalyticsFlipperPlugin.kt` |

### Protocolo de Comunicacion

**Direccion:** App Android -> Flipper Desktop (unidireccional)

**Metodo:** `analyticsEvent`

### Estructura de Datos

```typescript
type MeliaEvent = {
  id: number;        // Autoincremental, clave unica
  date: string;      // Timestamp (Date().toString() desde Android)
  eventName: string;  // Nombre del evento
  event: object;     // Payload completo del evento
};
```

### Datos Enviados desde Android

```kotlin
FlipperObject.Builder()
    .put("origin", origin)           // Fuente: "GA" o "AppsFlyer"
    .put("eventName", eventName)     // Nombre del evento
    .put("date", Date().toString())  // Timestamp
    .put("id", id++)                 // ID autoincremental
    .put("event", eventData)         // Payload como FlipperObject
    .build()
```

### Tipos de Eventos Soportados

1. **AnalyticsEvent** (Google Analytics): Contiene `name` y `params` (Map<String, Any?>)
2. **AppsFlyerEvent**: Contiene `eventName` y `eventValues` (Map<String, Any?>)
3. **Bundle generico**: Se convierte key-value a FlipperObject

### Ejemplo de Payload

```json
{
  "id": 42,
  "date": "Thu Feb 12 10:30:00 CET 2026",
  "eventName": "screen_view",
  "event": {
    "origin": "GA",
    "screen_name": "HotelDetail",
    "screen_class": "HotelDetailFragment",
    "hotel_code": "TRYP001"
  }
}
```

---

## Plugin 2: Network GraphQL

### Metadata

| Campo | Valor |
|-------|-------|
| **Plugin ID** | `Network GraphQL` |
| **Package** | `flipper-plugin-network-graphql` |
| **Tipo Desktop** | `PluginClient` (complejo, fork del Network plugin de Meta) |
| **Archivos Android** | `NetworkGraphQLFlipperPlugin.kt`, `FlipperOkhttpGraphQLInterceptor.kt` |

### Protocolo de Comunicacion

**Direccion:** Bidireccional

#### Eventos App -> Desktop

| Metodo | Descripcion |
|--------|-------------|
| `newRequest` | Nueva peticion HTTP/GraphQL |
| `newResponse` | Respuesta completa recibida |
| `partialResponse` | Chunk de respuesta parcial (dispositivos low-end) |
| `addProtobufDefinitions` | Definiciones Protobuf para decodificacion |

#### Metodos Desktop -> App

| Metodo | Descripcion |
|--------|-------------|
| `mockResponses` | Inyectar respuestas mock a la app |

### Estructuras de Datos

#### RequestInfo (newRequest)

```typescript
type RequestInfo = {
  id: string;              // Identificador unico de la peticion
  timestamp: number;       // Epoch millis
  method: string;          // GET, POST, etc.
  url: string;             // URL completa
  headers: Header[];       // Array de headers
  data: string | null;     // Body en base64
};

type Header = {
  key: string;
  value: string;
};
```

#### ResponseInfo (newResponse)

```typescript
type ResponseInfo = {
  id: string;              // Mismo ID que el request
  timestamp: number;       // Epoch millis
  status: number;          // HTTP status code
  reason: string;          // Status reason
  headers: Header[];       // Response headers
  data: string | null;     // Body en base64
  isMock: boolean;         // Si fue respuesta mockeada
  insights: Insights | null;
  totalChunks?: number;    // Para partial responses
  index?: number;          // Indice del chunk
};
```

#### ResponseFollowupChunk (partialResponse)

```typescript
type ResponseFollowupChunk = {
  id: string;
  totalChunks: number;
  index: number;           // >= 1 (el index 0 va en el ResponseInfo inicial)
  data: string;            // Chunk del body en base64
};
```

#### Insights (metricas de rendimiento)

```typescript
type Insights = {
  dnsLookupTime: number | null;
  connectTime: number | null;
  sslHandshakeTime: number | null;
  preTransferTime: number | null;
  redirectsTime: number | null;
  timeToFirstByte: number | null;
  transferTime: number | null;
  postProcessingTime: number | null;
  bytesTransfered: number | null;
  transferSpeed: number | null;
  retries: {
    count: number;
    limit: number;
    timeSpent: number;
  } | null;
};
```

#### Request (modelo procesado en desktop)

```typescript
interface Request {
  id: string;
  // Request
  requestTime: Date;
  method: string;
  url: string;
  operation: string;       // GraphQL operationName (extraido del body)
  domain: string;          // Host + path
  requestHeaders: Header[];
  requestData: string | Uint8Array | undefined;
  // Response
  responseTime?: Date;
  status?: number;
  reason?: string;
  responseHeaders?: Header[];
  responseData?: string | Uint8Array | undefined;
  responseLength?: number;
  requestLength?: number;
  responseIsMock?: boolean;
  duration?: number;       // responseTimestamp - requestTimestamp (ms)
  insights?: Insights;
}
```

#### MockRoute (mockResponses, desktop -> app)

```typescript
type MockRoute = {
  requestUrl: string;
  method: string;
  data: string;            // Response body
  headers: Header[];
  status: string;          // HTTP status code como string
  enabled: boolean;
  operation: string;       // GraphQL operation name
};
```

### Decodificacion del Body

El body se envia en **base64** desde Android. El desktop lo decodifica segun `Content-Encoding`:

| Content-Encoding | Decodificacion |
|-------------------|----------------|
| `gzip` | base64 -> Uint8Array -> pako.inflate |
| `br` | base64 -> Buffer -> brotli.decompress |
| (ninguno) | base64 -> UTF-8 string o Uint8Array |

La extraccion del `operationName` de GraphQL se hace asi:

```typescript
const reqData = decodeBody(data.headers, data.data);
if (typeof reqData === "string" && reqData !== "") {
  operationName = JSON.parse(reqData).operationName;
}
```

### Ejemplo de Payload GraphQL

**Request:**
```json
{
  "id": "req-001",
  "timestamp": 1707730200000,
  "method": "POST",
  "url": "https://api.melia.com/graphql",
  "headers": [
    {"key": "Content-Type", "value": "application/json"},
    {"key": "Authorization", "value": "Bearer ..."}
  ],
  "data": "eyJvcGVyYXRpb25OYW1lIjoiR2V0SG90ZWwiLCJxdWVyeSI6Ii4uLiJ9"
}
```

**Response:**
```json
{
  "id": "req-001",
  "timestamp": 1707730200350,
  "status": 200,
  "reason": "OK",
  "headers": [{"key": "Content-Type", "value": "application/json"}],
  "data": "eyJkYXRhIjp7ImhvdGVsIjp7Im5hbWUiOiJNZWxpYSBNYWRyaWQifX19",
  "isMock": false,
  "insights": null
}
```

---

## Plugin 3: ViewModel State

### Metadata

| Campo | Valor |
|-------|-------|
| **Plugin ID** | `view-model-state` |
| **Package** | `flipper-plugin-view-model-state` |
| **Tipo Desktop** | `createTablePlugin` con sidebar custom |
| **Archivo Android** | `app/src/debug/java/com/mo2o/melia/utils/ViewModelStateFlipperPlugin.kt` |

### Protocolo de Comunicacion

**Direccion:** App Android -> Flipper Desktop (unidireccional)

**Metodo:** `stateUpdate`

### Estructura de Datos

```typescript
type ViewModelState = {
  id: number;           // Autoincremental
  viewModel: string;    // Nombre del ViewModel (javaClass.simpleName)
  action: string;       // "Init" | "Update" | "Clear"
  date: string;         // Timestamp
  differences: object;  // Solo los campos que cambiaron (diff)
  state: object;        // Estado completo del ViewModel
};
```

### Datos Enviados desde Android

**State Update:**
```kotlin
FlipperObject.Builder()
    .put("viewModel", viewModelName)      // ej: "HotelDetailViewModel"
    .put("action", "Update")              // o "Init" para estado inicial
    .put("date", Date().toString())
    .put("id", id++)
    .put("state", stateFlipper)           // Estado completo serializado
    .put("differences", differencesBuilder) // Solo campos modificados
    .build()
```

**State Clear (ViewModel destruido):**
```kotlin
FlipperObject.Builder()
    .put("viewModel", viewModelName)
    .put("action", "Clear")
    .put("date", Date().toString())
    .put("id", id++)
    .put("state", FlipperObject.Builder().build())        // vacio
    .put("differences", FlipperObject.Builder().build())  // vacio
    .build()
```

### Logica de Diff en Android

El plugin Android mantiene un `HashMap<String, FlipperObject>` con el ultimo estado de cada ViewModel. Al recibir un nuevo estado:

1. Serializa el nuevo state usando reflexion Kotlin (`KProperty`)
2. Compara cada propiedad con el estado anterior
3. Solo incluye en `differences` los campos que cambiaron
4. Guarda el nuevo estado como referencia para el proximo diff

### Ejemplo de Payload

```json
{
  "id": 15,
  "viewModel": "HotelDetailViewModel",
  "action": "Update",
  "date": "Thu Feb 12 10:31:00 CET 2026",
  "differences": {
    "isLoading": false,
    "hotelName": "Melia Madrid Princesa"
  },
  "state": {
    "isLoading": false,
    "hotelName": "Melia Madrid Princesa",
    "hotelCode": "TRYP001",
    "checkIn": "2026-03-01",
    "checkOut": "2026-03-05",
    "adults": 2,
    "children": 0,
    "rooms": 1
  }
}
```

---

## Plugin 4: Preferences / DataStore (nativo)

### Metadata

| Campo | Valor |
|-------|-------|
| **Plugin ID** | `Preferences` |
| **Tipo Desktop** | Plugin nativo de Flipper (no hay .tgz custom) |
| **Archivo Android** | `app/src/debug/java/com/mo2o/melia/utils/DataStoreFlipperPlugin.kt` |

### Protocolo de Comunicacion

**Direccion:** Bidireccional

#### Eventos App -> Desktop

| Metodo | Datos |
|--------|-------|
| `sharedPreferencesChange` | Cambio individual en una preferencia |

#### Metodos Desktop -> App

| Metodo | Descripcion |
|--------|-------------|
| `getAllSharedPreferences` | Lista todos los nombres de SharedPreferences/DataStores |
| `getSharedPreferences` | Obtiene todos los key-value de un store especifico |
| `setSharedPreference` | Modifica una preferencia |
| `deleteSharedPreference` | Elimina una preferencia |

### Estructura de Datos

#### sharedPreferencesChange

```typescript
type PreferenceChange = {
  preferences: string;  // Nombre del DataStore/SharedPreferences
  name: string;         // Key de la preferencia
  value: any;           // Valor (desencriptado si es sensible)
  deleted: boolean;     // Si fue eliminada
  time: number;         // Epoch millis
};
```

### Ejemplo de Payload

```json
{
  "preferences": "user_preferences",
  "name": "selected_language",
  "value": "es",
  "deleted": false,
  "time": 1707730200000
}
```

---

## Conexion con Flipper - Protocolo

### Opcion A: Flipper Client Protocol (WebSocket)

Flipper expone un servidor WebSocket en `localhost`. El protocolo interno:

- **Puerto por defecto:** `8088` (insegure) o `8089` (secure/TLS)
- **Formato de mensajes:** JSON-RPC sobre WebSocket
- Los mensajes siguen el formato:

```json
{
  "method": "execute",
  "params": {
    "api": "<plugin-id>",
    "method": "<method-name>",
    "params": { ... }
  }
}
```

### Opcion B: Flipper JS SDK (recomendada)

Usar `flipper-server-client` para conectarse programaticamente:

```typescript
import {FlipperServerClient} from 'flipper-server-client';

const client = new FlipperServerClient('localhost', 8089);
await client.connect();

// Suscribirse a mensajes de un plugin
client.on('plugin-message', (pluginId, method, data) => {
  // pluginId: "melia-analytics" | "Network GraphQL" | "view-model-state"
  // method: "analyticsEvent" | "newRequest" | "stateUpdate" | etc.
  // data: payload del mensaje
});
```

### Opcion C: Intercepcion directa via IDB/archivo

Flipper Desktop almacena datos en IndexedDB del Electron app. Se puede leer directamente si se conoce la ruta.

---

## Tools MCP Sugeridos

Basado en los plugins, estos serian los tools que el MCP deberia exponer:

### 1. `flipper_get_analytics_events`

```typescript
// Obtiene los ultimos eventos de analytics
{
  name: "flipper_get_analytics_events",
  parameters: {
    limit?: number,          // Maximo de eventos (default: 50)
    eventName?: string,      // Filtrar por nombre de evento
    origin?: "GA" | "AppsFlyer",  // Filtrar por origen
    since?: string           // Desde timestamp ISO
  },
  returns: MeliaEvent[]
}
```

### 2. `flipper_get_network_requests`

```typescript
// Obtiene las peticiones GraphQL capturadas
{
  name: "flipper_get_network_requests",
  parameters: {
    limit?: number,
    operation?: string,      // Filtrar por operationName
    status?: number,         // Filtrar por HTTP status
    method?: string,         // GET, POST, etc.
    urlContains?: string,    // Filtro parcial en URL
    includeBody?: boolean,   // Incluir request/response body (default: false)
    onlyErrors?: boolean     // Solo status >= 400
  },
  returns: Request[]
}
```

### 3. `flipper_get_viewmodel_states`

```typescript
// Obtiene los cambios de estado de ViewModels
{
  name: "flipper_get_viewmodel_states",
  parameters: {
    limit?: number,
    viewModel?: string,      // Filtrar por nombre de ViewModel
    action?: "Init" | "Update" | "Clear",
    onlyDifferences?: boolean  // Solo devolver diffs, no state completo
  },
  returns: ViewModelState[]
}
```

### 4. `flipper_get_preferences`

```typescript
// Obtiene cambios en SharedPreferences/DataStore
{
  name: "flipper_get_preferences",
  parameters: {
    store?: string,          // Nombre del DataStore/SharedPrefs
    key?: string,            // Filtrar por key especifica
    limit?: number
  },
  returns: PreferenceChange[]
}
```

### 5. `flipper_mock_response`

```typescript
// Inyecta una respuesta mock en la app
{
  name: "flipper_mock_response",
  parameters: {
    operation: string,       // GraphQL operation name
    requestUrl: string,
    method: string,          // HTTP method
    responseStatus: number,
    responseBody: string,    // JSON string
    responseHeaders?: Header[],
    enabled: boolean
  },
  returns: { success: boolean }
}
```

### 6. `flipper_get_connection_status`

```typescript
// Verifica estado de conexion con Flipper
{
  name: "flipper_get_connection_status",
  parameters: {},
  returns: {
    connected: boolean,
    deviceName?: string,
    appName?: string,
    plugins: string[]        // Lista de plugins activos
  }
}
```

---

## Archivos de Referencia del Proyecto

### Plugins Desktop (TypeScript)

| Plugin | Archivo principal |
|--------|-------------------|
| Analytics | `flipperDesktopPlugins/flipper-plugin-melia-analytics-1.0.0` -> `src/index.tsx` |
| Network GraphQL | `flipperDesktopPlugins/flipper-plugin-network-graphql-1.0.0` -> `index.tsx`, `types.tsx`, `utils.tsx` |
| ViewModel State | `flipperDesktopPlugins/flipper-plugin-view-model-state-v1.0.0` -> `src/index.tsx`, `ViewModelState.ts`, `Sidebar.tsx` |

### Plugins Android (Kotlin)

| Plugin | Archivo |
|--------|---------|
| Analytics | `app/src/debug/java/com/mo2o/melia/utils/AnalyticsFlipperPlugin.kt` |
| Network GraphQL | `app/src/debug/java/com/mo2o/melia/utils/NetworkGraphQLFlipperPlugin.kt` |
| Network Interceptor | `app/src/debug/java/com/mo2o/melia/utils/FlipperOkhttpGraphQLInterceptor.kt` |
| ViewModel State | `app/src/debug/java/com/mo2o/melia/utils/ViewModelStateFlipperPlugin.kt` |
| DataStore | `app/src/debug/java/com/mo2o/melia/utils/DataStoreFlipperPlugin.kt` |
| Inicializacion | `app/src/debug/java/com/mo2o/melia/utils/FlipperUtils.kt` |
| Release (no-ops) | `app/src/release/java/com/mo2o/melia/utils/FlipperUtils.kt` |
