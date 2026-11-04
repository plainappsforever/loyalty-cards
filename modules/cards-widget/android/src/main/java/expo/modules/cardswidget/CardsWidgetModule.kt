package expo.modules.cardswidget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The app pushes the widget snapshot; Settings offers the launcher's "Add to home screen" for each widget. */
class CardsWidgetModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("CardsWidget")

    Function("setData") { json: String ->
      WidgetSnapshot.save(context, json)
      CardsWidgets.refreshAll(context)
    }

    Function("setLinkShortcuts") { json: String -> CardsWidgets.setLinkShortcuts(context, json) }

    Function("widgetCount") { CardsWidgets.widgetIds(context, CardsGridProvider::class.java).size + CardsWidgets.widgetIds(context, CardBarcodeProvider::class.java).size }

    Function("requestPinWidget") { kind: String ->
      val provider = if (kind == "barcode") CardBarcodeProvider::class.java else CardsGridProvider::class.java
      if (CardsWidgets.widgetIds(context, provider).isNotEmpty()) return@Function "alreadyAdded"
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function "unsupported"
      val manager = context.getSystemService(AppWidgetManager::class.java)
      if (manager == null || !manager.isRequestPinAppWidgetSupported) return@Function "unsupported"
      if (manager.requestPinAppWidget(ComponentName(context, provider), null, null)) "requested" else "unsupported"
    }
  }
}
