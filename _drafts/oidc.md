---
layout: post
title: OpenID Connect in ASP.NET Core
---

Authentication and authorization is a complex topic. There's a reason they say never
to "roll your own" security. Yet the options and configurations are so many and complex,
that even getting something basic working can be daunting. This is a system I ended up
creating for a simple ASP.NET Core site.

## Background

Auth on the web is dominated by two technologies; OAuth 2 and OpenID Connect. ASP.NET Core 5,
(from here on just referred to as ASP.NET) contains some core libraries to deal with these
(Microsoft.AspNetCore.Authentication.OAuth and Microsoft.AspNetCore.Authentication.OpenIdConnect
respectively). However this gets confusing with names that overlap in terminology (e.g. 
Microsoft.AspNetCore.Identity), or layer over the top (e.g. Microsoft.Identity.Web - which replaces
AzureAD.UI and AzureADB2C.UI which are obsolete in .NET 5.0).

## TODO

- CORS and cookies
- Silent reauth vs redirect flow
- Authentication code, PKCE, implicit, hybrid, etc.
- Client credentials security
- Refresh tokens, lifetime, reuse
- IdentityServer4 setup
- OIDC lifecycle events
- Principals vs claims vs identities vs tickets
- Cookies, DPAPI, session storage
- id tokens vs auth tokens
- ASP.NET cookie lifetime (default 14 days, exires with ticket, with session, etc.)

## Links

- Microsoft.AspNetCore.Authentication.OpenIdConnect <https://github.com/dotnet/aspnetcore/tree/v5.0.4/src/Security/Authentication/OpenIdConnect/src>
- Microsoft.AspNetCore.Authentication.OAuth <https://github.com/dotnet/aspnetcore/tree/v5.0.4/src/Security/Authentication/OAuth/src>
- Microsoft.Identity.Web <https://github.com/AzureAD/microsoft-identity-web>
- MSAL <https://github.com/azuread/microsoft-authentication-library-for-dotnet>
- OAuth 2.0 RFC <https://tools.ietf.org/html/rfc6749>
- OpenID Connect specs <https://openid.net/developers/specs/>
- SameSite cookies <https://docs.microsoft.com/en-us/aspnet/core/security/samesite>
- CORS <https://docs.microsoft.com/en-us/aspnet/core/security/cors>
