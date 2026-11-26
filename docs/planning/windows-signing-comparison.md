# Windows distribution and code signing: options compared

Status: for decision. Nothing has been registered, purchased or configured.

NovaLoomBoard currently ships an unsigned NSIS installer, built locally and not attached to releases. This document compares the realistic ways to give Windows users a trustworthy installation, so the maintainer can choose based on the best long-term experience for users.

_Researched: November 2026. Prices and programme rules change, so check the linked sources before acting._

## Two different problems

Signing for the **Microsoft Store** and signing a **standalone installer** downloaded from GitHub are separate questions:

- **Store (MSIX package):** Microsoft re-signs the package after certification. The project needs no certificate. Store installs never show SmartScreen download warnings. But this covers only users who install from the Store.
- **Standalone installer (the `.exe` on GitHub releases, winget and similar):** the project must sign it with its own certificate, chaining to a certificate authority in the Microsoft Trusted Root Program. Even when signed, new files can show SmartScreen warnings until they build reputation.

Store distribution does not sign the GitHub installer. A project that wants both channels warning-free needs both a Store listing and a code-signing route.

## How SmartScreen decides

Facts from Microsoft's SmartScreen documentation:

- **Two signals:** publisher reputation (signed by a known publisher) and file-hash reputation (this exact file has been downloaded cleanly).
- **Unsigned files** start from zero reputation with every new version.
- **Reputation can carry over** between versions only when they are signed with the same publisher identity.
- **Signed files can still warn when they are new.** Microsoft says there is no exact threshold, but it "can take several weeks and hundreds of clean installs from a wide audience". There is no way to request a review for consumer devices.
- **EV certificates no longer bypass SmartScreen.** Microsoft removed that behaviour in 2024, so EV and OV certificates now build reputation the same way. Paying for EV only to avoid SmartScreen is no longer justified.
- **Smart App Control** on Windows 11 blocks unsigned files that have no positive reputation, for every executable, not only downloaded ones. On those machines, an unsigned NovaLoomBoard may simply not run.
- **The Store is exempt.** Store-distributed apps are signed by Microsoft and are never subject to SmartScreen download warnings.

## Options

### 1. Microsoft Store (MSIX)

| Aspect | Details |
| --- | --- |
| Cost | Free. Registration is free for individual developers through Microsoft's new sign-up flow; company accounts pay a one-time USD 99 fee. |
| Signing | Microsoft re-signs the package after certification. No certificate to buy or protect. |
| Publisher shown to users | The publisher display name reserved in Partner Center, for example the maintainer's name or a chosen publisher name. |
| SmartScreen | Never shown for Store installs. |
| Updates | Automatic, through the Store. |
| Restrictions | Windows 10 and 11 only. Each submission goes through certification, which can take up to a few business days. The app runs as a packaged app: NovaLoomBoard's Store build turns off file-system virtualisation with the restricted capability `unvirtualizedResources`, which needs a justification during certification. Users without Store access, such as some managed or offline PCs, can't use this channel. |
| Sustainability | Strong. No renewals and no costs. Depends on Microsoft keeping the free individual registration and the Store programme. |
| Project status | `--store` builds already work. The existing Partner Center reservation is for the old name, so "NovaLoomBoard" must be reserved. |

### 2. SignPath Foundation (free certificate for open-source projects)

| Aspect | Details |
| --- | --- |
| Cost | Free for qualifying open-source projects. |
| Signing | An OV-level certificate issued to SignPath Foundation, used through SignPath's managed signing service from the automated build. |
| Publisher shown to users | **"SignPath Foundation"**, not NovaLoomBoard or the maintainer. SignPath's terms state that SignPath Foundation is the publisher of the project's signed binaries. |
| SmartScreen | Standard OV behaviour: reputation builds over time. SignPath's own knowledge base warns that renewed OV certificates do not inherit reputation, which means warnings can return when the certificate is renewed. Whether the shared SignPath Foundation identity carries useful reputation from other projects is not documented, so it should not be assumed. |
| Requirements | OSI-approved licence with no commercial dual licensing (MIT qualifies). No proprietary components. Actively maintained, and already released in the form to be signed. Fully automated, verifiable builds. Multi-factor authentication for every team member on SignPath and GitHub. Named roles (authors, reviewers, approvers), with manual approval of every release. A "Code signing policy" section on the project page and release pages, with the attribution "Free code signing provided by SignPath.io, certificate by SignPath Foundation". A privacy policy, or the stated wording, is also required. |
| Restrictions | Sign only the project's own binaries. Upstream code may be included only under conditions in the terms. NovaLoomBoard bundles Electron's prebuilt runtime, so how that fits must be confirmed with SignPath before applying. SignPath may pause or end the subscription, or revoke the certificate, if its code of conduct is violated. There is no obligation to accept a project and no independent appeal. Its code of conduct is marked as a draft, so requirements may change. |
| Sustainability | Good while the programme continues. It depends on a third-party foundation's goodwill and policies, and the publisher name is never the project's own. |

### 3. Azure Artifact Signing (formerly Trusted Signing)

| Aspect | Details |
| --- | --- |
| Cost | About USD 9.99 per month (Basic tier), billed from account creation, plus an Azure subscription. |
| Publisher shown to users | The validated name of the individual or organisation. |
| SmartScreen | Microsoft says it does not give instant trust; reputation builds with consistent signing. No hardware token needed, and short-lived certificates under a stable identity. |
| Eligibility | Organisations in the USA, Canada, the EU and the UK; individuals in the USA and Canada only, according to Microsoft's code signing options page. |
| Restrictions | Not eligible for the Store's own signing, which isn't needed anyway. |
| Sustainability | Good, but it is a recurring paid subscription, which conflicts with the project's no-subscription principle unless a sponsor pays for it. |

### 4. A purchased OV certificate

| Aspect | Details |
| --- | --- |
| Cost | Microsoft lists USD 150 to 300 per year for OV certificates from major authorities. Certum sells an "Open Source Code Signing" certificate for individual open-source developers. Its shop lists a set with a smart card and reader at EUR 69 net, and a cloud version at a much higher price. The certificate validity period is being shortened from March 2026. |
| Publisher shown to users | The individual's name (for open-source certificates issued to people), or the organisation's name. |
| SmartScreen | Standard OV behaviour: reputation builds over time and may reset on renewal. |
| Restrictions | Since June 2023, private keys must live on a hardware token or HSM. A card-based key is hard to use from automated GitHub builds; cloud signing services make automation possible but cost more. |
| Sustainability | Recurring renewals, identity re-validation, and key custody fall on the maintainer. It's a paid option, against the project's no-cost approach. |

### 5. EV certificate

USD 400 or more per year. Since 2024, EV gives no SmartScreen advantage over OV. **Not recommended.**

### 6. Unsigned installer (status quo)

Free. Users see a strong SmartScreen warning, Smart App Control can block the app outright, and some organisations block unsigned software. **Acceptable only for developer previews.**

### Package managers

Package managers are channels, not signing solutions. winget validates submissions automatically (manifest, malware scan, and a check that it installs and uninstalls for administrators and other users). They help users discover and update the app, but they don't replace signing: the installer they download is the same file.

## Summary

| | Store (MSIX) | SignPath Foundation | Artifact Signing | OV certificate | Unsigned |
| --- | --- | --- | --- | --- | --- |
| Cost | Free | Free | About USD 9.99/month | About EUR 69 to USD 300/year | Free |
| Publisher shown | Your chosen name | "SignPath Foundation" | Your validated name | Your name | "Unknown publisher" |
| SmartScreen | Never | Warns until reputation builds | Warns until reputation builds | Warns until reputation builds | Strong warning; may be blocked |
| Covers GitHub installer | No | Yes | Yes | Yes | n/a |
| Automatic updates | Yes, built in | Needs app support | Needs app support | Needs app support | Needs app support |
| Fits project principles | Yes | Yes, with process obligations | Paid subscription | Paid | Yes, but poor experience |
| Available to the maintainer | Yes | After applying | Only in eligible countries | Yes | Yes |

## Recommendation

For the best long-term experience for users, at no cost:

1. **Make the Microsoft Store the primary Windows channel.** It is the only option with no SmartScreen warnings at all, it is free, it shows the project's own publisher name, and it handles updates. The build already exists. The next steps are reserving "NovaLoomBoard" in Partner Center, and preparing the justification for the `unvirtualizedResources` capability.
2. **Keep a signed standalone installer for everyone else**: users without the Store, managed PCs, winget, and people who prefer direct downloads. **Apply to SignPath Foundation for this**, once the release workflow is automated. First confirm with SignPath how bundled Electron binaries are treated.

   The trade-off to accept consciously is the publisher name "SignPath Foundation". If that is unacceptable, the cheapest alternative under the maintainer's own name is a Certum open-source certificate, but it costs money and is hard to automate.
3. **Until signing is in place,** publish the standalone installer only as a clearly labelled preview, with SHA-256 checksums.
4. **Don't buy EV certificates** at any point.

This order means most Windows users get a warning-free install early, through the Store. The standalone signing route can then be chosen without pressure.

## Decisions needed

- [ ] Use the Microsoft Store as the primary channel (needs a Partner Center name reservation under the maintainer's account).
- [ ] Apply to SignPath Foundation for the standalone installer, accepting "SignPath Foundation" as the publisher name; or choose a paid certificate in the maintainer's name instead.
- [ ] Whether to offer unsigned preview builds in the meantime.

## Sources

- Microsoft Learn: [code signing options for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) (updated November 2026)
- Microsoft Learn: [SmartScreen reputation for Windows app developers](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)
- Microsoft Learn: [MSI and EXE Store submission requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/create-app-submission)
- Windows Developer blog: [free developer registration for individual developers](https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/)
- SignPath Foundation: [terms and conditions](https://signpath.org/terms); [SignPath knowledge base on Windows signing and reputation](https://signpath.io/knowledge-base/windows-platform)
- Azure: [Artifact Signing pricing](https://azure.microsoft.com/pricing/details/artifact-signing/)
- Certum: [open source code signing](https://shop.certum.eu/open-source-code-signing.html); [code signing certificates](https://www.certum.eu/en/code-signing-certificates/)
- DigiCert: [EV-signed applications and SmartScreen warnings](https://knowledge.digicert.com/alerts/ev-signed-application-showing-microsoft-defender-smartscreen-warnings)
- Microsoft Learn: [submitting packages to the Windows Package Manager repository](https://learn.microsoft.com/windows/package-manager/package/repository)
