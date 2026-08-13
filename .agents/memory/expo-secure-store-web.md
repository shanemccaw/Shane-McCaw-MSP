---
name: expo-secure-store web limitation
description: expo-secure-store v56 has no web implementation — use AsyncStorage instead
---

## Rule
Never use `expo-secure-store` for credential storage that must work on Expo web.
Use `@react-native-async-storage/async-storage` instead — it works on both native and web (localStorage).

**Why:** `ExpoSecureStore.web.js` in v56 is literally `export default {}`. Every call to
`getItemAsync`/`setItemAsync` throws `TypeError: ExpoSecureStore.getValueWithKeyAsync is not a function`
on web. This silently prevents login from completing (setState never reached) on Expo web preview.

**How to apply:** In any Expo app where auth credentials must persist on web, replace
`import * as SecureStore from "expo-secure-store"` with
`import AsyncStorage from "@react-native-async-storage/async-storage"`.
