package app.fazmeucontrole.mobile;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class PackageUnitTest {

    @Test
    public void packageIdIsStable() {
        assertEquals("app.fazmeucontrole.mobile", BuildConfig.APPLICATION_ID);
    }
}
