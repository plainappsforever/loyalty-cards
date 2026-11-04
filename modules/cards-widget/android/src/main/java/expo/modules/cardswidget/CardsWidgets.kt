package expo.modules.cardswidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import java.io.File

private const val TAG = "CardsWidget"

/**
 * P7: the two home-screen widgets (plain RemoteViews, mood-journal/Breathe pattern: no JS runs for them). Both draw from
 * the snapshot the app pushed (WidgetSnapshot); every tap is a PendingIntent to `<scheme>://card/<id>` (SPEC §6.4).
 */
object CardsWidgets {
  private val TILE = intArrayOf(R.id.cards_widget_tile_0, R.id.cards_widget_tile_1, R.id.cards_widget_tile_2, R.id.cards_widget_tile_3)
  private val TILE_BG = intArrayOf(R.id.cards_widget_tile_0_bg, R.id.cards_widget_tile_1_bg, R.id.cards_widget_tile_2_bg, R.id.cards_widget_tile_3_bg)
  private val TILE_INITIALS = intArrayOf(R.id.cards_widget_tile_0_initials, R.id.cards_widget_tile_1_initials, R.id.cards_widget_tile_2_initials, R.id.cards_widget_tile_3_initials)
  private val TILE_NAME = intArrayOf(R.id.cards_widget_tile_0_name, R.id.cards_widget_tile_1_name, R.id.cards_widget_tile_2_name, R.id.cards_widget_tile_3_name)

  fun widgetIds(context: Context, provider: Class<out AppWidgetProvider>): IntArray =
    runCatching { AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, provider)) }.getOrDefault(IntArray(0))

  fun refreshAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    widgetIds(context, CardsGridProvider::class.java).takeIf { it.isNotEmpty() }?.let { renderGrid(context, manager, it) }
    widgetIds(context, CardBarcodeProvider::class.java).takeIf { it.isNotEmpty() }?.let { renderBarcode(context, manager, it) }
  }

  private fun color(hex: String?, fallback: Int) = runCatching { Color.parseColor(hex) }.getOrDefault(fallback)

  /**
   * D53: NEW_TASK + CLEAR_TASK. With NEW_TASK alone, a tap after Android killed the process but kept the task restored
   * the old activity with its old launch intent and handed this link over as onNewIntent before JavaScript listened, so
   * the Cards list opened instead of the card (V1_LOG P8a-2 item 4). CLEAR_TASK starts a fresh activity whose launch
   * intent IS this link. Back from the opened card leaves the app (usual for a widget deep link).
   */
  private fun linkIntent(context: Context, url: String): Intent =
    Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)

  private fun link(context: Context, url: String, requestCode: Int): PendingIntent =
    PendingIntent.getActivity(context, requestCode, linkIntent(context, url), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

  /**
   * D53: the app shortcuts on Android, as the same `<scheme>://card/<id>` link as a widget tile (JSON `[{id,title,url}]`).
   * expo-quick-actions' shortcut intent reaches a restored activity as onNewIntent too (same cold-tap defect), and with
   * CLEAR_TASK its JS `initial` (read once per JS runtime) would be stale on a warm tap; a link works in both cases.
   */
  fun setLinkShortcuts(context: Context, json: String): Int {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) return 0
    val manager = context.getSystemService(ShortcutManager::class.java) ?: return 0
    val items = JSONArray(json)
    val shortcuts = (0 until items.length()).map { i ->
      val item = items.getJSONObject(i)
      val title = item.getString("title")
      ShortcutInfo.Builder(context, item.getString("id")).setShortLabel(title).setLongLabel(title).setRank(i)
        .setIntent(linkIntent(context, item.getString("url"))).build()
    }
    manager.dynamicShortcuts = shortcuts
    return shortcuts.size
  }

  /** Placed before the app ever ran: a tap opens the app, which pushes the real snapshot. */
  private fun launch(context: Context, views: RemoteViews, root: Int, requestCode: Int) {
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
      views.setOnClickPendingIntent(root, PendingIntent.getActivity(context, requestCode, it, PendingIntent.FLAG_IMMUTABLE))
    }
  }

  fun renderGrid(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val snapshot = WidgetSnapshot.read(context)
    val views = RemoteViews(context.packageName, R.layout.cards_widget_grid)
    if (snapshot == null) {
      launch(context, views, R.id.cards_widget_grid_root, 70)
      manager.updateAppWidget(ids, views)
      return
    }
    views.setTextViewText(R.id.cards_widget_grid_title, snapshot.title)
    views.setViewVisibility(R.id.cards_widget_grid_empty, if (snapshot.cards.isEmpty()) View.VISIBLE else View.GONE)
    views.setTextViewText(R.id.cards_widget_grid_empty, snapshot.empty)
    for (i in 0 until 4) {
      val card = snapshot.cards.getOrNull(i)
      if (card == null) {
        views.setViewVisibility(TILE[i], View.INVISIBLE)
        continue
      }
      views.setViewVisibility(TILE[i], View.VISIBLE)
      views.setInt(TILE_BG[i], "setColorFilter", color(card.color, Color.GRAY))
      views.setTextViewText(TILE_INITIALS[i], card.initials)
      views.setTextColor(TILE_INITIALS[i], color(card.fg, Color.BLACK))
      views.setTextViewText(TILE_NAME[i], card.name)
      views.setContentDescription(TILE[i], "${card.name}, ${snapshot.open}")
      views.setOnClickPendingIntent(TILE[i], link(context, card.url, 100 + i))
    }
    views.setOnClickPendingIntent(R.id.cards_widget_grid_root, link(context, snapshot.appUrl, 99))
    manager.updateAppWidget(ids, views)
    Log.d(TAG, "grid drawn: ${snapshot.cards.take(4).joinToString { it.name }} (${ids.size})")
  }

  /** The PNG at its own pixel size: density = the screen's, so one PNG pixel is one device pixel (scale from layout()). */
  private fun loadCode(context: Context, path: String): Bitmap? {
    val file = File(path)
    if (!file.exists()) return null
    val options = BitmapFactory.Options().apply { inScaled = false }
    return runCatching { BitmapFactory.decodeFile(file.absolutePath, options) }.getOrNull()?.also {
      it.density = context.resources.displayMetrics.densityDpi
    }
  }

  fun renderBarcode(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val snapshot = WidgetSnapshot.read(context)
    val views = RemoteViews(context.packageName, R.layout.cards_widget_barcode)
    val card = snapshot?.cards?.firstOrNull()
    if (snapshot == null || card == null) {
      views.setViewVisibility(R.id.cards_widget_barcode_card, View.GONE)
      views.setViewVisibility(R.id.cards_widget_barcode_empty, View.VISIBLE)
      if (snapshot != null) {
        views.setTextViewText(R.id.cards_widget_barcode_empty, snapshot.empty)
        views.setOnClickPendingIntent(R.id.cards_widget_barcode_root, link(context, snapshot.appUrl, 109))
      } else launch(context, views, R.id.cards_widget_barcode_root, 71)
      manager.updateAppWidget(ids, views)
      return
    }
    views.setViewVisibility(R.id.cards_widget_barcode_card, View.VISIBLE)
    views.setViewVisibility(R.id.cards_widget_barcode_empty, View.GONE)
    views.setInt(R.id.cards_widget_barcode_tile_bg, "setColorFilter", color(card.color, Color.GRAY))
    views.setTextViewText(R.id.cards_widget_barcode_tile_initials, card.initials)
    views.setTextColor(R.id.cards_widget_barcode_tile_initials, color(card.fg, Color.BLACK))
    views.setTextViewText(R.id.cards_widget_barcode_name, card.name)
    views.setTextViewText(R.id.cards_widget_barcode_number, card.number)
    views.setViewVisibility(R.id.cards_widget_barcode_number, if (card.number.isEmpty()) View.GONE else View.VISIBLE)
    val bitmap = card.image?.let { loadCode(context, it.path) }
    if (bitmap != null) {
      views.setImageViewBitmap(R.id.cards_widget_barcode_image, bitmap)
      views.setViewVisibility(R.id.cards_widget_barcode_image, View.VISIBLE)
      views.setViewVisibility(R.id.cards_widget_barcode_hint, View.GONE)
      views.setContentDescription(R.id.cards_widget_barcode_image, "${card.name} ${card.number}")
    } else {
      views.setViewVisibility(R.id.cards_widget_barcode_image, View.GONE)
      views.setViewVisibility(R.id.cards_widget_barcode_hint, View.VISIBLE)
      views.setTextViewText(R.id.cards_widget_barcode_hint, if (card.kind == "none") snapshot.open else snapshot.noCode)
    }
    views.setOnClickPendingIntent(R.id.cards_widget_barcode_root, link(context, card.url, 110))
    manager.updateAppWidget(ids, views)
    Log.d(TAG, "barcode drawn: ${card.name} image=${bitmap?.width}x${bitmap?.height} (${ids.size})")
  }
}

class CardsGridProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    CardsWidgets.renderGrid(context, appWidgetManager, appWidgetIds)
  }
}

class CardBarcodeProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    CardsWidgets.renderBarcode(context, appWidgetManager, appWidgetIds)
  }
}
