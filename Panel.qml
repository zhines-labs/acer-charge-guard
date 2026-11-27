import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.UPower
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Model.js" as Model

Panel {
  id: root
  moduleName: "io.github.zhines-labs.acer-charge-guard"
  ipcTarget: "io.github.zhines-labs.acer-charge-guard"
  // Own the IpcHandler so the toggle methods below are reachable from
  // `omarchy-shell io.github.zhines-labs.acer-charge-guard toggleHealth` (keybindings, scripts).
  manageIpc: false

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  // Last sysfs snapshot: { health, calibration, tempMilli, loaded }. -1 = unknown.
  property var wmi: ({ health: -1, calibration: -1, tempMilli: NaN, loaded: false })
  property string errorText: ""
  property int cursorIndex: 0
  property bool cursorActive: false

  readonly property bool present: Model.driverPresent(wmi)
  readonly property bool busy: writeProc.running
  readonly property bool onAc: !UPower.onBattery
  readonly property real batteryFraction: {
    var d = UPower.displayDevice
    return d && d.isPresent ? Math.max(0, Math.min(1, d.percentage)) : 0
  }

  readonly property var power: Model.powerReading(wmi)
  // Signed for readability: + into the battery, − out of it.
  readonly property string wattsText: {
    if (!isFinite(power.watts)) return "—"
    var sign = power.direction === "charging" ? "+" : (power.direction === "discharging" ? "−" : "")
    return sign + Commons.I18n.formatNumber(power.watts, 1) + " W"
  }

  readonly property string statusText: {
    if (!present) return strings.t("status.noDriver")
    if (wmi.calibration === 1) return strings.t("status.calibrating")
    return wmi.health === 1 ? strings.t("status.limited") : strings.t("status.unlimited")
  }

  function refresh() {
    if (!readProc.running) readProc.running = true
  }

  function context() {
    return { health: wmi.health, calibration: wmi.calibration, onAc: root.onAc }
  }

  function apply(plan) {
    if (busy) return
    if (plan.blockedKey) { errorText = strings.t(plan.blockedKey); return }
    var argv = Model.writeCommand(plan.writes)
    if (argv.length === 0) return
    errorText = ""
    writeProc.command = argv
    writeProc.running = true
  }

  function toggleHealth() {
    if (present) apply(Model.planHealth(wmi.health !== 1, context()))
  }

  function toggleCalibration() {
    if (present) apply(Model.planCalibration(wmi.calibration !== 1, context()))
  }

  function activateCursor() {
    if (cursorIndex === 0) toggleHealth()
    else toggleCalibration()
  }

  ShellIpc {
    target: "io.github.zhines-labs.acer-charge-guard"

    function open() { root.open() }
    function close() { root.close() }
    function show() { root.open() }
    function hide() { root.close() }
    function toggle() { root.toggle() }
    function toggleHealth() { root.toggleHealth() }
    function toggleCalibration() { root.toggleCalibration() }
  }

  onOpenedChanged: {
    if (opened) {
      errorText = ""
      cursorActive = false
      refresh()
    }
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Process {
    id: readProc
    command: Model.readCommand()
    stdout: StdioCollector { waitForEnd: true; onStreamFinished: root.wmi = Model.parseSysfs(text) }
  }

  Process {
    id: writeProc
    onExited: function(code) {
      // pkexec: 126 = dialog dismissed / not authorized, 127 = auth failed.
      if (code === 126 || code === 127) root.errorText = strings.t("error.auth")
      else if (code !== 0) root.errorText = strings.t("error.write").arg(code)
      root.refresh()
    }
  }

  // Sysfs has no change notifications, so poll: quickly while the panel is
  // open, slowly otherwise so the bar icon still catches external changes.
  Timer {
    interval: root.opened ? 5000 : 60000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: Model.barIcon(root.wmi)
    tooltipText: !root.present ? strings.t("tooltip.noDriver")
      : root.wmi.calibration === 1 ? strings.t("tooltip.calibrating")
      : root.wmi.health === 1 ? strings.t("tooltip.limited") : strings.t("tooltip.unlimited")
    onPressed: function(b) {
      if (b === Qt.RightButton) root.toggleHealth()
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: panel.loadedContent
    contentWidth: panel.fittedContentWidth(Style.space(380))
    contentHeight: panel.fittedContentHeight(panel.loadedContentHeight)

    content: PanelKeyCatcher {
      anchors.fill: parent
      implicitHeight: column.implicitHeight
      onMoveRequested: function(dx, dy) {
        if (!root.cursorActive) { root.cursorActive = true; return }
        var delta = dy !== 0 ? dy : dx
        root.cursorIndex = Math.max(0, Math.min(1, root.cursorIndex + delta))
      }
      onActivateRequested: if (root.cursorActive) root.activateCursor()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(14)

        // ---------- Hero: icon · title/status · charge % ----------
        Item {
          width: parent.width
          implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight, heroPercent.implicitHeight)

          PlainText {
            id: heroIcon
            text: Model.barIcon(root.wmi)
            font.pixelSize: Style.font.display
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
          }

          Column {
            id: heroLabels
            anchors.left: heroIcon.right
            anchors.leftMargin: Style.space(14)
            anchors.right: heroPercent.left
            anchors.rightMargin: Style.space(10)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            PlainText {
              text: strings.t("title")
              font.pixelSize: Style.font.title
              font.bold: true
              elide: Text.ElideRight
              width: parent.width
            }

            PlainText {
              text: root.statusText.toUpperCase()
              color: Qt.darker(root.bar.foreground, 1.4)
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 1.2
              elide: Text.ElideRight
              width: parent.width
            }
          }

          PlainText {
            id: heroPercent
            text: Commons.I18n.formatNumber(Math.round(root.batteryFraction * 100)) + "%"
            font.pixelSize: Style.font.displayLarge
            font.bold: true
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
          }
        }

        // ---------- Stats ----------
        Row {
          visible: root.present
          width: parent.width
          spacing: Style.space(20)

          Column {
            width: (parent.width - parent.spacing) / 2
            spacing: Style.spacing.labelGap
            InfoPair {
              width: parent.width
              label: strings.t("stat.temperature")
              value: isFinite(Model.tempCelsius(root.wmi))
                ? Commons.I18n.formatNumber(Model.tempCelsius(root.wmi), 1) + " °C" : "—"
            }
            InfoPair {
              width: parent.width
              label: strings.t("stat.source")
              value: root.onAc ? strings.t("stat.ac") : strings.t("stat.battery")
            }
          }

          Column {
            width: (parent.width - parent.spacing) / 2
            spacing: Style.spacing.labelGap
            InfoPair {
              width: parent.width
              label: strings.t("stat.power")
              value: root.wattsText
            }
            InfoPair {
              width: parent.width
              label: strings.t("stat.flow")
              value: strings.t("flow." + root.power.direction)
            }
          }
        }

        PanelSeparator { foreground: root.bar.foreground }

        // ---------- Toggles ----------
        Toggle {
          width: parent.width
          enabled: root.present && root.wmi.health >= 0
          opacity: enabled ? 1 : 0.5
          label: strings.t("health.label")
          description: strings.t("health.description")
          checked: root.wmi.health === 1
          hasCursor: root.cursorActive && root.cursorIndex === 0
          foreground: root.bar.foreground
          fontFamily: root.bar.fontFamily
          onClicked: root.toggleHealth()
          onHovered: function(h) { if (h) { root.cursorActive = true; root.cursorIndex = 0 } }
        }

        Toggle {
          width: parent.width
          enabled: root.present && root.wmi.calibration >= 0
          opacity: enabled ? 1 : 0.5
          label: strings.t("calibration.label")
          description: strings.t("calibration.description")
          checked: root.wmi.calibration === 1
          hasCursor: root.cursorActive && root.cursorIndex === 1
          foreground: root.bar.foreground
          fontFamily: root.bar.fontFamily
          onClicked: root.toggleCalibration()
          onHovered: function(h) { if (h) { root.cursorActive = true; root.cursorIndex = 1 } }
        }

        // ---------- Busy / error line ----------
        PlainText {
          visible: text !== ""
          width: parent.width
          wrapMode: Text.WordWrap
          text: root.busy ? strings.t("busy") : root.errorText
          color: root.busy ? root.bar.foreground : root.bar.urgent
          font.pixelSize: Style.font.caption
        }
      }
    }
  }

  component PlainText: Text {
    textFormat: Text.PlainText
    color: root.bar.foreground
    font.family: root.bar.fontFamily
  }

  component InfoPair: Row {
    property string label: ""
    property string value: ""
    spacing: Style.space(8)

    PlainText { id: pairLabel; text: label; opacity: 0.6; font.pixelSize: Style.font.bodySmall }
    Item { width: Math.max(0, parent.width - pairLabel.implicitWidth - pairValue.implicitWidth - parent.spacing * 2); height: 1 }
    PlainText { id: pairValue; text: value; font.pixelSize: Style.font.bodySmall }
  }
}
