package expo.modules.appexit

import android.os.Handler
import android.os.Looper
import android.os.Process
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Really exits, which `BackHandler.exitApp()` does not: that calls MainActivity's
 * `invokeDefaultOnBackPressed` -> `moveTaskToBack`, leaving the task warm in recents to be
 * resumed exactly where it was. The user asked for Exit to mean exit.
 *
 * `finishAndRemoveTask()` finishes every activity in the task AND drops its card from the
 * recents screen — plain `finish()`/`finishAffinity()` would leave a dead card there that
 * cold-starts the app when tapped. The delayed `killProcess` then takes the process itself:
 * without it Android keeps the process cached with the ReactHost (and all module-scope JS
 * state) alive inside it, so the next launch would attach to a half-warm runtime rather than
 * starting clean. The 150ms delay lets the finish IPC land and the window animate out first;
 * the task is already gone from recents by then, so the kill is invisible.
 */
class AppExitModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AppExit")

    Function("killApp") {
      val activity = appContext.currentActivity
      // Activity lifecycle calls belong on the main thread; sync Functions run on the JS thread.
      Handler(Looper.getMainLooper()).post {
        activity?.finishAndRemoveTask()
        Handler(Looper.getMainLooper()).postDelayed({
          Process.killProcess(Process.myPid())
        }, 150)
      }
    }
  }
}
