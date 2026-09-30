# Full Discord Locale Mapping (December 2025)

This document lists all Discord locales (a mix of ISO 639‑1 and IETF BCP 47) along with their corresponding simplified ISO 639‑1 language codes.  
You do not need to use ISO 639‑1 in your internal system, it's just provided here for convenience.  
Use this as a reference when working with translations in your project.

For more details, see the official Discord documentation:
[Discord Locales](https://discord.com/developers/docs/reference#locales)

| Locale   | ISO 639-1 | Language Name             | Native Name        |
|----------|-----------|---------------------------|--------------------|
| id       | id        | Indonesian                | Bahasa Indonesia   |
| da       | da        | Danish                    | Dansk              |
| de       | de        | German                    | Deutsch            |
| en-GB    | en        | English, UK               | English, UK        |
| en-US    | en        | English, US               | English, US        |
| en       | en        | English                   | English            |
| es-ES    | es        | Spanish, Spain            | Español            |
| es-419   | es        | Spanish, LATAM            | Español, LATAM     |
| fr       | fr        | French                    | Français           |
| hr       | hr        | Croatian                  | Hrvatski           |
| it       | it        | Italian                   | Italiano           |
| lt       | lt        | Lithuanian                | Lietuviškai        |
| hu       | hu        | Hungarian                 | Magyar             |
| nl       | nl        | Dutch                     | Nederlands         |
| no       | no        | Norwegian                 | Norsk              |
| pl       | pl        | Polish                    | Polski             |
| pt-BR    | pt        | Portuguese, Brazilian     | Português do Brasil|
| ro       | ro        | Romanian                  | Română             |
| fi       | fi        | Finnish                   | Suomi              |
| sv-SE    | sv        | Swedish                   | Svenska            |
| vi       | vi        | Vietnamese                | Tiếng Việt         |
| tr       | tr        | Turkish                   | Türkçe             |
| cs       | cs        | Czech                     | Čeština            |
| el       | el        | Greek                     | Ελληνικά           |
| bg       | bg        | Bulgarian                 | български          |
| ru       | ru        | Russian                   | Pусский            |
| uk       | uk        | Ukrainian                 | Українська         |
| hi       | hi        | Hindi                     | हिन्दी               |
| th       | th        | Thai                      | ไทย                |
| zh-CN    | zh        | Chinese, China            | 中文               |
| ja       | ja        | Japanese                  | 日本語             |
| zh-TW    | zh        | Chinese, Taiwan           | 繁體中文           |
| ko       | ko        | Korean                    | 한국어             |

> **Note:** This mapping is a simplified reference. In your project, you can use a reduced `localeMap` for the languages you actually support, for example:

```js
const localeMap = { 'en-GB': 'en', 'en-US': 'en', 'en': 'en', 'fr': 'fr' };
```