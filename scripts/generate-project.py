#!/usr/bin/env python3
"""Generate the checked-in Xcode project without third-party project tooling."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
objects = {}


def uid(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()


def obj(label, isa, **values):
    identifier = uid(label)
    objects[identifier] = {"isa": isa, **values}
    return identifier


def file(path, kind):
    return obj(path, "PBXFileReference", lastKnownFileType=kind, path=path, sourceTree="SOURCE_ROOT")


def build(ref, label):
    return obj("build:" + label, "PBXBuildFile", fileRef=ref)


def phase(label, isa, files, **extra):
    return obj(label, isa, buildActionMask=2147483647, files=files, runOnlyForDeploymentPostprocessing=0, **extra)


app_source = file("App/AniSkipSafariApp.swift", "sourcecode.swift")
handler = file("Extension/SafariWebExtensionHandler.swift", "sourcecode.swift")
core = file("Sources/AniSkipCore/AniSkipClient.swift", "sourcecode.swift")
assets = file("App/Assets.xcassets", "folder.assetcatalog")
resources = [file("Extension/Resources/" + name, "folder" if name == "icons" else
                  "text.json" if name.endswith(".json") else "text.html" if name.endswith(".html") else
                  "text.css" if name.endswith(".css") else "sourcecode.javascript")
             for name in ["manifest.json", "core.js", "background.js", "content.js", "player-bridge.js", "popup.html", "popup.css", "popup.js", "overlay.css", "icons"]]
app_info = file("App/Info.plist", "text.plist.xml")
app_ent = file("App/App.entitlements", "text.plist.entitlements")
ext_info = file("Extension/Info.plist", "text.plist.xml")
ext_ent = file("Extension/Extension.entitlements", "text.plist.entitlements")
app_product = obj("app-product", "PBXFileReference", explicitFileType="wrapper.application", path="aniskip.app", sourceTree="BUILT_PRODUCTS_DIR", includeInIndex=0)
ext_product = obj("ext-product", "PBXFileReference", explicitFileType="wrapper.app-extension", path="aniskip Extension.appex", sourceTree="BUILT_PRODUCTS_DIR", includeInIndex=0)

common = dict(MACOSX_DEPLOYMENT_TARGET="27.0", SWIFT_VERSION="5.0", SDKROOT="macosx", CLANG_ENABLE_MODULES="YES", CLANG_ENABLE_OBJC_ARC="YES", ENABLE_HARDENED_RUNTIME="YES", MARKETING_VERSION="0.1.0", CURRENT_PROJECT_VERSION="1", CODE_SIGN_STYLE="Automatic", GENERATE_INFOPLIST_FILE="NO", COMBINE_HIDPI_IMAGES="YES")


def configurations(label, settings):
    configs = []
    for name in ["Debug", "Release"]:
        values = {**common, **settings, "SWIFT_OPTIMIZATION_LEVEL": "-Onone" if name == "Debug" else "-O", "DEBUG_INFORMATION_FORMAT": "dwarf" if name == "Debug" else "dwarf-with-dsym"}
        if name == "Debug":
            values.update(SWIFT_ACTIVE_COMPILATION_CONDITIONS="DEBUG", ENABLE_TESTABILITY="YES")
        configs.append(obj(f"config:{label}:{name}", "XCBuildConfiguration", buildSettings=values, name=name))
    return obj("configs:" + label, "XCConfigurationList", buildConfigurations=configs, defaultConfigurationIsVisible=0, defaultConfigurationName="Release")


ext_target_id = uid("extension-target")
proxy = obj("extension-proxy", "PBXContainerItemProxy", containerPortal=uid("project"), proxyType=1, remoteGlobalIDString=ext_target_id, remoteInfo="AniSkipSafari Extension")
dependency = obj("extension-dependency", "PBXTargetDependency", target=ext_target_id, targetProxy=proxy)
embed_build = obj("embed-extension", "PBXBuildFile", fileRef=ext_product, settings={"ATTRIBUTES": ["RemoveHeadersOnCopy"]})
app_phases = [phase("app-sources", "PBXSourcesBuildPhase", [build(app_source, "app-source")]),
              phase("app-frameworks", "PBXFrameworksBuildPhase", []),
              phase("app-resources", "PBXResourcesBuildPhase", [build(assets, "app-assets")]),
              phase("embed-extensions", "PBXCopyFilesBuildPhase", [embed_build], dstPath="", dstSubfolderSpec=13, name="Embed App Extensions")]
ext_phases = [phase("ext-sources", "PBXSourcesBuildPhase", [build(handler, "handler"), build(core, "core")]),
              phase("ext-frameworks", "PBXFrameworksBuildPhase", []),
              phase("ext-resources", "PBXResourcesBuildPhase", [build(ref, "resource:" + ref) for ref in resources])]
app_target = obj("app-target", "PBXNativeTarget", name="AniSkipSafari", productName="aniskip", productReference=app_product, productType="com.apple.product-type.application", buildConfigurationList=configurations("app", {"PRODUCT_BUNDLE_IDENTIFIER": "com.gridness.AniSkipSafari", "PRODUCT_NAME": "aniskip", "INFOPLIST_FILE": "App/Info.plist", "CODE_SIGN_ENTITLEMENTS": "App/App.entitlements", "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon", "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/../Frameworks"]}), buildPhases=app_phases, buildRules=[], dependencies=[dependency])
ext_target = obj("extension-target", "PBXNativeTarget", name="AniSkipSafari Extension", productName="aniskip Extension", productReference=ext_product, productType="com.apple.product-type.app-extension", buildConfigurationList=configurations("extension", {"PRODUCT_BUNDLE_IDENTIFIER": "com.gridness.AniSkipSafari.Extension", "PRODUCT_NAME": "aniskip Extension", "INFOPLIST_FILE": "Extension/Info.plist", "CODE_SIGN_ENTITLEMENTS": "Extension/Extension.entitlements", "APPLICATION_EXTENSION_API_ONLY": "YES", "SKIP_INSTALL": "YES", "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/../Frameworks", "@executable_path/../../../../Frameworks"]}), buildPhases=ext_phases, buildRules=[], dependencies=[])
groups = [obj("app-group", "PBXGroup", name="App", sourceTree="<group>", children=[app_source, assets, app_info, app_ent]),
          obj("extension-group", "PBXGroup", name="Extension", sourceTree="<group>", children=[handler, core, ext_info, ext_ent, *resources]),
          obj("products-group", "PBXGroup", name="Products", sourceTree="<group>", children=[app_product, ext_product])]
main = obj("main-group", "PBXGroup", sourceTree="<group>", children=groups)
project = obj("project", "PBXProject", attributes={"BuildIndependentTargetsInParallel": "YES", "LastUpgradeCheck": "2700", "TargetAttributes": {app_target: {"CreatedOnToolsVersion": "27.0"}, ext_target: {"CreatedOnToolsVersion": "27.0"}}}, buildConfigurationList=configurations("project", {}), compatibilityVersion="Xcode 14.0", developmentRegion="en", hasScannedForEncodings=0, knownRegions=["en", "Base"], mainGroup=main, productRefGroup=groups[-1], projectDirPath="", projectRoot="", targets=[app_target, ext_target])


def render(value, depth=0):
    if isinstance(value, dict):
        lines = ["{"]
        for k, v in value.items():
            lines.append("\t" * (depth + 1) + f"{render(k)} = {render(v, depth + 1)};")
        return "\n".join(lines) + "\n" + "\t" * depth + "}"
    if isinstance(value, list):
        return "(" + ", ".join(render(v, depth) for v in value) + ("," if value else "") + ")"
    value = str(value)
    return value if re.fullmatch(r"[A-Za-z0-9_./]+", value) else json.dumps(value)


project_dir = ROOT / "AniSkipSafari.xcodeproj"
project_dir.mkdir(exist_ok=True)
(project_dir / "project.pbxproj").write_text("// !$*UTF8*$!\n" + render({"archiveVersion": 1, "classes": {}, "objectVersion": 56, "objects": objects, "rootObject": project}) + "\n")
scheme_dir = project_dir / "xcshareddata/xcschemes"
scheme_dir.mkdir(parents=True, exist_ok=True)
reference = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{app_target}" BuildableName="aniskip.app" BlueprintName="AniSkipSafari" ReferencedContainer="container:AniSkipSafari.xcodeproj"/>'
(scheme_dir / "AniSkipSafari.xcscheme").write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.3">
 <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{reference}</BuildActionEntry></BuildActionEntries></BuildAction>
 <TestAction buildConfiguration="Debug" shouldUseLaunchSchemeArgsEnv="YES"/>
 <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></LaunchAction>
 <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></ProfileAction>
 <AnalyzeAction buildConfiguration="Debug"/>
 <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
''')
print("Generated AniSkipSafari.xcodeproj")
