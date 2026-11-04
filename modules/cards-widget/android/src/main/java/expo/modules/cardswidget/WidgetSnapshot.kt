package expo.modules.cardswidget

import android.content.Context
import org.json.JSONObject

/**
 * The snapshot the app pushed (src/lib/widget-data.ts WidgetData): words in the UI language, the app link and up to 8
 * cards in widget order (chosen, favourites, most used). `image` is the barcode PNG the app wrote at the module size
 * layout() chose for the barcode widget's code box; absent = the widget shows the tile and "Open".
 */
data class WidgetImage(val path: String, val widthDp: Double, val heightDp: Double)

data class WidgetCard(
  val id: String,
  val name: String,
  val color: String,
  val fg: String,
  val initials: String,
  val url: String,
  val number: String,
  val kind: String,
  val image: WidgetImage?,
)

data class WidgetSnapshot(val title: String, val open: String, val empty: String, val noCode: String, val appUrl: String, val cards: List<WidgetCard>) {
  companion object {
    private const val PREFS = "cards_widget"
    private const val KEY = "snapshot"

    fun parse(json: String): WidgetSnapshot {
      val o = JSONObject(json)
      val list = o.getJSONArray("cards")
      val cards = (0 until list.length()).map { i ->
        val c = list.getJSONObject(i)
        val img = c.optJSONObject("image")?.let { WidgetImage(it.getString("uri").removePrefix("file://"), it.getDouble("width"), it.getDouble("height")) }
        WidgetCard(
          c.getString("id"),
          c.getString("name"),
          c.getString("color"),
          c.optString("fg", "#000000"),
          c.getString("initials"),
          c.getString("url"),
          c.optString("number", ""),
          c.optString("kind", "none"),
          img,
        )
      }
      return WidgetSnapshot(o.getString("title"), o.getString("open"), o.getString("empty"), o.getString("noCode"), o.getString("appUrl"), cards)
    }

    fun save(context: Context, json: String) {
      parse(json) // refuse anything the widgets could not draw
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
    }

    fun read(context: Context): WidgetSnapshot? {
      val json = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return null
      return runCatching { parse(json) }.getOrNull()
    }
  }
}
