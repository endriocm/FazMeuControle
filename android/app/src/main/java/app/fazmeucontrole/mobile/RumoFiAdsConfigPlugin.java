package app.fazmeucontrole.mobile;

import android.content.pm.ApplicationInfo;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "RumoFiAdsConfig")
public class RumoFiAdsConfigPlugin extends Plugin {
    @PluginMethod
    public void getConfig(PluginCall call) {
        JSObject result = new JSObject();
        result.put("isDebug", (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        call.resolve(result);
    }
}
