package app.fazmeucontrole.mobile;

import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        View contentRoot = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(contentRoot, (view, windowInsets) -> {
            Insets systemInsets = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout()
            );
            Insets keyboardInsets = windowInsets.getInsets(WindowInsetsCompat.Type.ime());

            view.setPadding(
                systemInsets.left,
                systemInsets.top,
                systemInsets.right,
                Math.max(systemInsets.bottom, keyboardInsets.bottom)
            );

            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(contentRoot);
    }
}
