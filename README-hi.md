# dsh-doc-positivize

DeepSeek Harness (DSH) के लिए एक plugin जो documentation को सकारात्मक और वर्तमान रखता है: system prompt में एक स्थायी अंग्रेज़ी guard, और `/positivize` command जो documentation, comments और commit text में negative या historical वाक्यांशों को सकारात्मक विवरण में बदलता है।

## What it does

`apply` दो योगदान पंजीकृत करता है: global system-prompt section — `doc-positivize:guard`, order `6000` — और मानव command `/positivize`. Guard सक्रिय होने पर हर request पर लागू होता है, command केवल टाइप करने पर, host process में।

## Why doc-positivize

नाम में क्षेत्र और क्रिया दोनों हैं: documentation, positivized. Guard यह नियम हर model request पर लागू करता है; `/positivize` इसे मौजूदा artefacts पर लागू करता है।

संदर्भ परियोजना का नियम है: **absence is negation; affirmative is the standard**.

## The guard contract

अंतर्निहित guard अंग्रेज़ी में है, हर first-party prompt section की तरह, और marker scan में शून्य hits के साथ पास होता है:

- **केवल अंतिम स्थिति**: code, comments, commit और MR/PR शीर्षक व विवरण, documentation और prompts वर्तमान design को ऐसे बताते हैं जैसे वह शुरू से ऐसा ही था।
- **अनुपस्थिति ही निषेध है**: जब कोई feature, behaviour या पुरानी plan design से हटती है, उसका विवरण भी साथ हटता है; केवल स्वीकृत design रहता है।
- **सकारात्मक ही मानक है**: rules, prompts, tool schemas और comments एकमात्र सकारात्मक अभ्यास और उसकी शर्त बताते हैं; superseded tools और पुरानी अवधारणाएँ हटा दी जाती हैं।

`tests/guard.test.ts` इस contract को स्थिर रखता है: default text marker patterns पर शून्य hits के साथ पास होता है, अंग्रेज़ी में रहता है, और literal braces को literal रखता है।

## The /positivize command

```text
/positivize                  वर्तमान workspace को सकारात्मक विवरण में बदलें
/positivize README*.md       उस scope की फ़ाइलों को सकारात्मक विवरण में बदलें
```

Web GUI में command markers की सूची से scope scan करता है, हर फ़ाइल के लिए वर्तमान session के model से न्यूनतम JSON edit plan माँगता है, edits को जगह पर लागू करता है, और composer खाली करने के लिए तुरंत लौटता है। उसका result card structured diff, चलते sweep के दौरान **Stop** button, और हर बदली फ़ाइल पर **Undo** button दिखाता है। Sweep model history से बाहर रहता है, इसलिए मौजूदा conversation अपना context बनाए रखती है।

Connection service के बिना hosts (CLI और headless) foreground path इस्तेमाल करते हैं: command sweep के खत्म होने तक रुकता है और पूरा text report लौटाता है।

Sweep `maxFiles`, `maxFileBytes` और `timeoutMs` से सीमित है; report अगली बार के लिए छोड़ी गई फ़ाइलें बताता है। यह संदर्भ परियोजना के exemptions का पालन करता है (program logic और test assertions, public SDK Semver deprecation notices, high-risk boundaries positive preconditions के रूप में, और user-input literal matches)। यह फ़ाइलें सीधे बदलता है और test suite नहीं चलाता: code बदलने वाले sweep के बाद प्रोजेक्ट के tests चलाएँ।

## Result card, undo, and stop

Result card अपना unified diff render करता है: hunk headers, line numbers और theme के added/deleted रंग। पहली बदली फ़ाइल खुली रहती है, बाकी folded; हर row `+added` / `-deleted` counts दिखाती है।

- **Stop** चल रहा sweep abort करता है। Stop से पहले बदली फ़ाइलें listed रहती हैं और उनके Undo buttons बने रहते हैं; कोई नया model request या write शुरू नहीं होता।
- **Undo** उस एक फ़ाइल को sweep से पहले की content पर लौटाता है। जिस फ़ाइल का मौजूदा content sweep output से मेल नहीं खाता, उसे overwrite करने से मना करता है; और वह कभी ऐसा path स्वीकार नहीं करता जो run ने record न किया हो।
- Undo केवल sweep settle होने के बाद उपलब्ध है। कोई bulk undo या redo नहीं है।
- बिना बदलाव वाला run खाली card के बजाय एक compact पंक्ति में सिमटता है।
- Run state Host process में रहती है: Host restart के बाद card command के compact summary पर लौटता है और actions नहीं देता।

Card Connection की तीन exact, owner-authenticated routes इस्तेमाल करता है: `GET /api/doc-positivize.state?runId=…`, `POST /api/doc-positivize.cancel`, और `POST /api/doc-positivize.undo`. Undo request केवल उस फ़ाइल को चुनता है जिसे run पहले ही बदल चुका है; नया write target नहीं जोड़ सकता।

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.2.2-rc.1`; कोई 0.2.x जिसमें `systemPrompt.section()`, `ctx.commands` और `ctx.llm` हों |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Services | `systemPrompt`, `commands` और `llm`, तीनों `@deepseek-ai/dsh-base` में; वैकल्पिक `connection` result card की Stop/Undo routes देता है |
| Client | Web GUI: package में Plugins पेज के लिए `dsh.client` settings card और `/positivize` result card है |
| Runtime imports | `@deepseek-ai/schemastery` |
| Config | Schemastery `Config` schema; अमान्य मान load पर विफल |

## Install

यह repository plugin को build और pack करता है; नीचे दिए command इसे profile में install करते हैं।

```sh
pnpm install
pnpm build
pnpm pack --pack-destination ./.pack

# स्थानीय spec का पूर्ण पथ होना चाहिए
dsh plugin --profile <profile> add "$PWD/.pack/dsh-doc-positivize-0.1.0-alpha.10.tgz"

# पुष्टि करें कि bundle row mount हुआ
dsh --profile <profile> --dump-config | grep dsh-doc-positivize
```

सफल `dsh plugin add` package को `dsh.profile.bundles` में भी दर्ज करता है; सक्रिय करने के लिए app restart करें (या profile reload करें)।

## Configuration

| Key | Type | Default | Description |
|---|---|---|---|
| `guardEnabled` | boolean | `true` | always-on guard section mount करता है |
| `guard` | string | अंतर्निहित अंग्रेज़ी guard | पूरा section बदलता है |
| `extra` | string | `""` | खाली पंक्ति के बाद जोड़ा गया project मार्गदर्शन |
| `command` | boolean | `true` | `/positivize` command पंजीकृत करता है |
| `ignoredPaths` | string[] | अंतर्निहित सूची | sweep द्वारा छोड़े जाने वाले names, paths या globs |
| `maxFiles` | number | `12` | एक sweep में अधिकतम candidate फ़ाइलें |
| `maxFileBytes` | number | `96000` | model को भेजी जाने वाली एक फ़ाइल के अधिकतम bytes |
| `timeoutMs` | number | `180000` | एक sweep का समय बजट, milliseconds में |

## Settings

पैकेज एक web settings card देता है, इसलिए guard switch और sweep ignore list को `cordis.patch.yml` बदले बिना संपादित किया जा सकता है:

- Settings → **Doc Positivize** खोलें;
- **Enable the doc-positivize guard** always-on rule को चालू/बंद करता है;
- **Ignored files and directories** एक multiline editor है, प्रति पंक्ति एक name, path या glob, जिससे पूरी सूची paste की जा सके; **Save** profile entry लिखता है और **Restore defaults** built-in सूची लौटाता है.

Sweep results per-file undo देते हैं; चल रहा sweep अपने card से रोका जा सकता है। दोनों actions तभी उपलब्ध हैं जब Host वह run रखता है।

Built-in सूची: `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`, `.turbo`, `.cache`, `.pnpm-store`, `.pnpm-cache`, `.pack`, `target`, `vendor`, `.venv`, `__pycache__`, और pnpm, npm, yarn, bun lockfiles. स्पष्ट रूप से नामित फ़ाइल अपने directory के ignore सूची में होने पर भी sweep होती है।

## Where it applies

Order `6000` खाली `5000`–`9000` पट्टी में है: सभी tool sections के बाद और deliverable/environment block से पहले। Section global है और पाठ स्थिर है, इसलिए prefix cache बना रहता है; प्रति request लगभग 210 tokens। Sweep के model calls host process में होते हैं और conversation में नहीं आते, जो केवल command lifecycle का खर्च उठाती है।

## Development

```sh
pnpm install
pnpm typecheck
pnpm test          # unit tests और वास्तविक SystemPrompt/Commands integration
pnpm smoke:built   # build के बाद lib/index.js को वास्तविक registries पर mount करता है
node <dsh-plugin-guide>/dist/dsh-plugin-dev.js check --cwd .
```

`check` एक चेतावनी देता है: `packageManager` (स्थानीय `pnpm@10.34.6` बनाम `pnpm@11.7.0`)।

`0.1.0` पहला प्रकाशित संस्करण है। स्थानीय debugging builds अगले संस्करण का `-alpha.N` suffix (जैसे `0.1.0-alpha.1`) उपयोग करते हैं और उन्हें कभी release के रूप में प्रस्तुत नहीं किया जाता।

## Verify

`dsh-plugin-dev verify` plugin को pack करके साफ़ अस्थायी `DSH_HOME` में install करता है। `0.2.2-rc.1` पर बिना credentials वाला smoke `TRANSPORT: DeepSeek Messages transport failed` पर रुकता है; install और `--dump-config` पास होते हैं, और boot prompt को `system/message` event के रूप में लिखता है — वहाँ guard खोजें।

## Attribution

Guard और sweep workflow संदर्भ परियोजना [ox01024/pink-elephant](https://github.com/ox01024/pink-elephant) (MIT, Copyright © 2026 ox01024) से adapted हैं। देखें [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)।

## License

Apache-2.0. देखें [LICENSE](LICENSE).
